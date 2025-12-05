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
  serverActions: {
    bodySizeLimit: '10mb', // Aumentar límite para manejar grandes cantidades de datos de tutores/estudiantes
  },
}

export default nextConfig