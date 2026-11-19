/// The parsed form of a Range request.
#[derive(Debug, PartialEq, Eq)]
pub enum ByteRangeRequest {
    /// No range given. Return the whole body with 200.
    Whole,
    /// A byte range, inclusive at both ends. Return it with 206 and Content-Range.
    Partial { start: i64, end: i64 },
    /// A well-formed range that cannot be satisfied. Return 416.
    Unsatisfiable,
}

/// Parses the HTTP Range header.
///
/// This is needed for audio. <audio> reads audio files with Range requests.
/// As measured, it first asks for the total length with `bytes=0-1`, then reads
/// the start and the end (the moov atom) of the MP4 in separate jumps. If the
/// whole body keeps coming back as 200, the audio element drops to
/// networkState=3 (NETWORK_NO_SOURCE) and never plays.
///
/// A range that cannot be parsed becomes Whole. RFC 7233 asks for an invalid Range
/// to be ignored and the whole body returned, which is safer than half-interpreting
/// it and breaking something. The exception is a suffix range whose length cannot be
/// parsed (`bytes=-abc`, `bytes=-`): that returns Unsatisfiable.
/// Multiple ranges (`bytes=0-1,5-6`) also get the whole body instead of a multipart
/// response.
pub fn parse_byte_range(header: Option<&str>, total_length: i64) -> ByteRangeRequest {
    use ByteRangeRequest::*;

    let Some(header) = header else { return Whole };
    let spec: String = header.chars().filter(|c| *c != ' ').collect();
    let Some(value) = spec.strip_prefix("bytes=") else {
        return Whole;
    };
    // Multiple ranges are not handled.
    if value.contains(',') {
        return Whole;
    }
    let Some(dash) = value.find('-') else {
        return Whole;
    };

    let first_text = &value[..dash];
    let last_text = &value[dash + 1..];

    // Suffix range (bytes=-N)
    if first_text.is_empty() {
        let Ok(suffix) = last_text.parse::<i64>() else {
            return Unsatisfiable;
        };
        if suffix <= 0 || total_length <= 0 {
            return Unsatisfiable;
        }
        return Partial {
            start: (total_length - suffix).max(0),
            end: total_length - 1,
        };
    }

    let Ok(start) = first_text.parse::<i64>() else {
        return Whole;
    };
    if total_length <= 0 || start >= total_length {
        return Unsatisfiable;
    }

    if last_text.is_empty() {
        return Partial {
            start,
            end: total_length - 1,
        };
    }
    let Ok(requested_end) = last_text.parse::<i64>() else {
        return Whole;
    };
    if requested_end < start {
        return Whole;
    }
    Partial {
        start,
        end: requested_end.min(total_length - 1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ByteRangeRequest::*;

    #[test]
    fn no_range_is_whole() {
        assert_eq!(parse_byte_range(None, 100), Whole);
    }

    #[test]
    fn first_two_bytes() {
        assert_eq!(
            parse_byte_range(Some("bytes=0-1"), 100),
            Partial { start: 0, end: 1 }
        );
    }

    #[test]
    fn open_ended_reads_to_the_end() {
        assert_eq!(
            parse_byte_range(Some("bytes=10-"), 100),
            Partial { start: 10, end: 99 }
        );
    }

    #[test]
    fn end_beyond_length_is_clamped() {
        assert_eq!(
            parse_byte_range(Some("bytes=50-999"), 100),
            Partial { start: 50, end: 99 }
        );
    }

    #[test]
    fn suffix_range_is_last_n_bytes() {
        assert_eq!(
            parse_byte_range(Some("bytes=-20"), 100),
            Partial { start: 80, end: 99 }
        );
    }

    #[test]
    fn suffix_beyond_length_is_whole_file() {
        assert_eq!(
            parse_byte_range(Some("bytes=-500"), 100),
            Partial { start: 0, end: 99 }
        );
    }

    #[test]
    fn start_at_or_past_length_is_unsatisfiable() {
        assert_eq!(parse_byte_range(Some("bytes=100-"), 100), Unsatisfiable);
    }

    #[test]
    fn suffix_zero_is_unsatisfiable() {
        assert_eq!(parse_byte_range(Some("bytes=-0"), 100), Unsatisfiable);
    }

    #[test]
    fn empty_file_is_unsatisfiable() {
        assert_eq!(parse_byte_range(Some("bytes=0-"), 0), Unsatisfiable);
    }

    #[test]
    fn malformed_headers_are_whole() {
        for header in ["", "bytes=5-3", "items=0-1", "bytes=abc", "bytes=10", "bytes=0-1,5-6"] {
            assert_eq!(parse_byte_range(Some(header), 100), Whole, "header={header:?}");
        }
    }

    #[test]
    fn real_world_head_request() {
        assert_eq!(
            parse_byte_range(Some("bytes=0-1"), 559_277),
            Partial { start: 0, end: 1 }
        );
    }
}
