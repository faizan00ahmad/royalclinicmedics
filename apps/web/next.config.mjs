/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@rmc/core", "@rmc/db", "@rmc/auth"], serverExternalPackages: ["pg", "@electric-sql/pglite"],
  poweredByHeader: false,
};

export default nextConfig;
