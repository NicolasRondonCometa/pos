import { CredentialsForm } from "@/components/credentials-form"

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-50 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-neutral-900 font-lota">PowerSchool Integration</h1>
          <p className="mt-3 text-lg text-neutral-600">
            Suba sus credenciales encriptadas para ver las integraciones y escuelas disponibles
          </p>
        </div>
        <CredentialsForm />
      </div>
    </main>
  )
}
