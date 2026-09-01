/// Range 要求の解釈結果。
#[derive(Debug, PartialEq, Eq)]
pub enum ByteRangeRequest {
    /// 範囲指定なし。全体を 200 で返す。
    Whole,
    /// 両端を含むバイト範囲。206 と Content-Range で返す。
    Partial { start: i64, end: i64 },
    /// 形は正しいが満たせない範囲。416 で返す。
    Unsatisfiable,
}

/// HTTP の Range ヘッダを解釈する。
///
/// これが要るのは音声のため。<audio> は音声ファイルを Range 要求で読む。
/// 実測では、まず `bytes=0-1` で全体の長さを尋ね、続いて MP4 の先頭と
/// 末尾(moov アトム)を飛び飛びに読みに来る。全体を 200 で返し続けると
/// 音声要素は networkState=3 (NETWORK_NO_SOURCE) に落ち、一切再生されない。
///
/// 解釈できない指定は Whole にする。RFC 7233 は不正な Range を無視して
/// 全体を返すことを求めており、中途半端に解釈して壊すより安全。
/// 複数範囲(`bytes=0-1,5-6`)も、multipart で返す代わりに全体を返す。
pub fn parse_byte_range(header: Option<&str>, total_length: i64) -> ByteRangeRequest {
    use ByteRangeRequest::*;

    let Some(header) = header else { return Whole };
    let spec: String = header.chars().filter(|c| *c != ' ').collect();
    let Some(value) = spec.strip_prefix("bytes=") else {
        return Whole;
    };
    // 複数範囲は扱わない
    if value.contains(',') {
        return Whole;
    }
    let Some(dash) = value.find('-') else {
        return Whole;
    };

    let first_text = &value[..dash];
    let last_text = &value[dash + 1..];

    // 末尾からの指定(bytes=-N)
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
    fn empty_string_is_whole() {
        assert_eq!(parse_byte_range(Some(""), 100), Whole);
    }

    #[test]
    fn first_two_bytes() {
        assert_eq!(
            parse_byte_range(Some("bytes=0-1"), 100),
            Partial { start: 0, end: 1 }
        );
    }

    #[test]
    fn ten_bytes_in_the_middle() {
        assert_eq!(
            parse_byte_range(Some("bytes=10-19"), 100),
            Partial { start: 10, end: 19 }
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
    fn end_before_start_is_whole() {
        assert_eq!(parse_byte_range(Some("bytes=5-3"), 100), Whole);
    }

    #[test]
    fn non_bytes_unit_is_whole() {
        assert_eq!(parse_byte_range(Some("items=0-1"), 100), Whole);
    }

    #[test]
    fn non_numeric_is_whole() {
        assert_eq!(parse_byte_range(Some("bytes=abc"), 100), Whole);
    }

    #[test]
    fn missing_dash_is_whole() {
        assert_eq!(parse_byte_range(Some("bytes=10"), 100), Whole);
    }

    #[test]
    fn multiple_ranges_are_whole() {
        assert_eq!(parse_byte_range(Some("bytes=0-1,5-6"), 100), Whole);
    }

    #[test]
    fn tolerates_whitespace() {
        assert_eq!(
            parse_byte_range(Some("bytes = 0 - 1 "), 100),
            Partial { start: 0, end: 1 }
        );
    }

    #[test]
    fn real_world_head_request() {
        assert_eq!(
            parse_byte_range(Some("bytes=0-1"), 559_277),
            Partial { start: 0, end: 1 }
        );
    }

    #[test]
    fn real_world_tail_request() {
        assert_eq!(
            parse_byte_range(Some("bytes=559027-559034"), 559_277),
            Partial {
                start: 559_027,
                end: 559_034
            }
        );
    }
}
