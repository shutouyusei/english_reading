"use strict";

/* Dictionary layer (public site). The public site has no dictionary lookup, so this always
   returns null. It only matches the interface, so the caller (vocab.js) does not have to check
   whether it is running in the app. On the public site the Weblio link remains the pointer. */

window.Dict = {
  async define(_word) {
    return null;
  },
};
