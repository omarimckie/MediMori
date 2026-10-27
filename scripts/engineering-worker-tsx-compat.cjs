"use strict";

// tsx calls os.userInfo() to form its cache directory on platforms without
// process.geteuid(). Some restricted Windows hosts fail that lookup with this
// specific libuv error. Limit the fallback to that exact case and leave every
// successful result and unrelated error unchanged.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node loads this compatibility file as a CJS preload.
const os = require("node:os");
const originalUserInfo = os.userInfo;

if (typeof process.geteuid !== "function") {
  os.userInfo = function userInfoWithWindowsPasswdFallback(...args) {
    try {
      return Reflect.apply(originalUserInfo, this, args);
    } catch (error) {
      const isHostPasswdLookupFailure = error?.code === "ERR_SYSTEM_ERROR"
        && error?.syscall === "uv_os_get_passwd"
        && error?.info?.code === "ENOMEM";
      if (!isHostPasswdLookupFailure) throw error;
      return {
        username: "medimori-worker-cache",
        uid: -1,
        gid: -1,
        shell: "",
        homedir: process.cwd(),
      };
    }
  };
}
