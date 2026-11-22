/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@rmc/core", "@rmc/db"], serverExternalPackages: ["pg"],
  poweredByHeader: false,
};

export default nextConfig;
