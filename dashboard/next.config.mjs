/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // node-cron uses worker_threads + Node's stream API which webpack can't
  // bundle. Mark it as external so Node requires it natively at runtime.
  serverExternalPackages: ["node-cron"],
  // The standalone tracer can't see our hidden createRequire('node-cron'),
  // so it doesn't copy it into the standalone bundle. Force its inclusion
  // (and its dependency luxon) so production runtime can resolve it.
  outputFileTracingIncludes: {
    "/": ["./node_modules/node-cron/**", "./node_modules/luxon/**"],
  },
  experimental: {
    optimizePackageImports: ["recharts", "date-fns", "lucide-react", "@supabase/supabase-js"],
  },
};

export default nextConfig;
