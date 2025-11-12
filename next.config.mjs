/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActionsBodySizeLimit: '10mb', // Aumentar límite para manejar grandes cantidades de datos de tutores
  },
}

export default nextConfig