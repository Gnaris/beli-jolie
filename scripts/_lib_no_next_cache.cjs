// Stub next/cache so unstable_cache becomes a no-op in tsx scripts.
// Load via NODE_OPTIONS="-r ./scripts/_lib_no_next_cache.cjs" before tsx.
const Module = require("module");
const origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (req, ...rest) {
  if (req === "next/cache") return "__next_cache_stub__";
  return origResolve(req, ...rest);
};
require.cache["__next_cache_stub__"] = {
  id: "__next_cache_stub__",
  filename: "__next_cache_stub__",
  loaded: true,
  exports: {
    unstable_cache: (fn) => fn,
    revalidateTag: () => {},
    revalidatePath: () => {},
    unstable_noStore: () => {},
  },
};
