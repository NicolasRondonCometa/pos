"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Spinner } from "@/components/ui/spinner"
import { Checkbox } from "@/components/ui/checkbox"
import {
  validateCredentials,
  getSchools,
  getStudents,
  getCometaGuardians, // Agregando import de getCometaGuardians
  performMatching,
  performGuardiansMatching,
  type MatchRule,
  type MatchedStudent,
  getGuardiansForSingleSchool, // Agregando import de getGuardiansForSingleSchool
} from "@/app/actions/credentials"
import { Upload, ArrowLeft, CheckCircle2, Loader2, Users, UserCheck } from "lucide-react"
import { StudentsTable } from "./students-table"
import { MatchConfig } from "./match-config"
import { MatchResultsTable } from "./match-results-table"
import { DiscrepancyResolver } from "./discrepancy-resolver" // Imported new component
import { Badge } from "@/components/ui/badge" // Imported new component

interface Integration {
  tenant_integration_id: string
  name: string
  partner: string
  tenant_id: string
}

interface School {
  id: string
  name: string
  [key: string]: any
}

interface SchoolProgress {
  id: string
  name: string
  status: "pending" | "processing" | "completed" | "error"
}

type ViewState =
  | "credentials"
  | "integrations"
  | "dataType"
  | "schools"
  | "students"
  | "matchConfig"
  | "matchResults"
  | "discrepancyResolver" // Added new view state for discrepancy resolver
  | "loading"
type DataType = "students" | "guardians"

interface GuardiansProgress {
  currentSchool: string
  currentSchoolName: string
  schoolIndex: number
  totalSchools: number
  currentStudent: number
  totalStudents: number
  totalGuardians: number
  isLoadingComplete: boolean
}

export function CredentialsForm() {
  const [jsonInput, setJsonInput] = useState("")
  const [fileName, setFileName] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [view, setView] = useState<ViewState>("credentials")
  const [loadingMessage, setLoadingMessage] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [integrations, setIntegrations] = useState<Integration[] | null>(null)
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null)
  const [schools, setSchools] = useState<School[] | null>(null)
  const [selectedSchools, setSelectedSchools] = useState<string[]>([])
  const [fileValidated, setFileValidated] = useState(false)
  const [students, setStudents] = useState<any[]>([])
  const [schoolsProgress, setSchoolsProgress] = useState<SchoolProgress[]>([])
  const [dataType, setDataType] = useState<DataType | null>(null)
  const [matchResults, setMatchResults] = useState<MatchedStudent[]>([])
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [guardiansProgress, setGuardiansProgress] = useState<GuardiansProgress | null>(null)
  const [isLoadingGuardians, setIsLoadingGuardians] = useState(false)

  const [powerschoolData, setPowerschoolData] = useState<any[]>([])
  const [cometaData, setCometaData] = useState<any[]>([])
  const [isLoadingPowerschool, setIsLoadingPowerschool] = useState(false)
  const [isLoadingCometa, setIsLoadingCometa] = useState(false)

  const processFile = async (file: File) => {
    setFileName(file.name)
    setError(null)
    setFileValidated(false)

    try {
      const text = await file.text()

      const parsed = JSON.parse(text)

      let iv: string
      let data: string

      if (parsed.iv && parsed.data) {
        iv = parsed.iv
        data = parsed.data
      } else if (parsed.data && parsed.data.iv && parsed.data.data) {
        iv = parsed.data.iv
        data = parsed.data.data
      } else {
        setError("El archivo no contiene los campos necesarios (iv y data)")
        setFileName(null)
        return
      }

      setFileValidated(true)
      setJsonInput(text)

      setTimeout(() => {
        handleValidateCredentials(iv, data)
      }, 800)
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError("El archivo no contiene un JSON válido")
      } else {
        setError("Error al leer el archivo. Por favor asegúrese de que sea un archivo de texto válido.")
      }
      setFileName(null)
      setFileValidated(false)
    }
  }

  const handleValidateCredentials = async (iv: string, data: string) => {
    setView("loading")
    setLoadingMessage("Validando credenciales...")
    setError(null)
    setIntegrations(null)
    setSchools(null)
    setSelectedIntegration(null)

    try {
      const result = await validateCredentials({ iv, data })

      if (result.success && result.integrations) {
        setIntegrations(result.integrations)
        setTenantId(result.tenantId || null)
        setView("integrations")
      } else {
        setError(result.error || "Error al validar las credenciales")
        setView("credentials")
        setFileValidated(false)
      }
    } catch (err) {
      setError("Ocurrió un error inesperado")
      setView("credentials")
      setFileValidated(false)
    }
  }

  const handleGetSchools = async (integration: Integration) => {
    setSelectedIntegration(integration)
    setView("loading")
    setLoadingMessage(`Cargando escuelas de ${integration.name}...`)
    setError(null)
    setSchools(null)
    setSelectedSchools([])

    try {
      const result = await getSchools(integration.tenant_integration_id)

      if (result.success && result.schools) {
        setSchools(result.schools)
        setSelectedSchools(result.schools.map((s) => s.id))
        setView("schools")
      } else {
        setError(result.error || "Error al obtener las escuelas")
        setView("integrations")
      }
    } catch (err) {
      setError("Ocurrió un error inesperado al obtener las escuelas")
      setView("integrations")
    }
  }

  const handleSchoolsSelected = () => {
    if (selectedSchools.length === 0) {
      setError("Por favor seleccione al menos una escuela")
      return
    }
    setView("dataType")
    setError(null)
  }

  const handleSelectDataType = async (type: DataType) => {
    if (!selectedIntegration || !schools) return

    setDataType(type)
    setError(null)
    setPowerschoolData([])
    setCometaData([])
    setStudents([])
    setGuardiansProgress(null)
    setIsLoadingGuardians(false)
    setIsLoadingPowerschool(false)
    setIsLoadingCometa(false)

    const initialProgress: SchoolProgress[] = selectedSchools.map((schoolId) => {
      const school = schools.find((s) => s.id === schoolId)
      return {
        id: schoolId,
        name: school?.name || `Escuela ${schoolId}`,
        status: "pending" as const,
      }
    })
    setSchoolsProgress(initialProgress)

    setView("matchConfig")

    try {
      if (type === "students") {
        setIsLoadingPowerschool(true)
        const allStudents: any[] = []

        for (let i = 0; i < selectedSchools.length; i++) {
          const schoolId = selectedSchools[i]
          const school = schools.find((s) => s.id === schoolId)

          setSchoolsProgress((prev) => prev.map((s) => (s.id === schoolId ? { ...s, status: "processing" } : s)))
          setLoadingMessage(`Procesando estudiantes de ${school?.name || `Escuela ${schoolId}`}...`)

          const result = await getStudents(selectedIntegration.tenant_integration_id, schoolId)

          if (result.success && result.students) {
            const studentsWithSchool = result.students.map((student) => ({
              ...student,
              school_id: schoolId,
            }))
            allStudents.push(...studentsWithSchool)
            setSchoolsProgress((prev) => prev.map((s) => (s.id === schoolId ? { ...s, status: "completed" } : s)))
          } else {
            console.error(`[v0] Error getting students for school ${schoolId}:`, result.error)
            setSchoolsProgress((prev) => prev.map((s) => (s.id === schoolId ? { ...s, status: "error" } : s)))
          }
        }

        setIsLoadingPowerschool(false)
        setPowerschoolData(allStudents)
        setStudents(allStudents)
        setSchoolsProgress([])

        if (allStudents.length === 0) {
          setError("No se encontraron estudiantes en las escuelas seleccionadas")
        }
      } else if (type === "guardians") {
        setIsLoadingPowerschool(true)
        setLoadingMessage("Cargando tutores de PowerSchool...")

        try {
          const allGuardians: any[] = []
          const totalSchools = selectedSchools.length

          for (let i = 0; i < selectedSchools.length; i++) {
            const schoolId = selectedSchools[i]
            const school = schools.find((s) => s.id === schoolId)
            const schoolName = school?.name || `Escuela ${schoolId}`

            setGuardiansProgress({
              currentSchool: schoolId,
              currentSchoolName: schoolName,
              schoolIndex: i + 1,
              totalSchools,
              currentStudent: 0,
              totalStudents: 1,
              totalGuardians: allGuardians.length,
              isLoadingComplete: false,
            })

            setLoadingMessage(`Procesando tutores de ${schoolName}...`)
            console.log(`[v0] [${i + 1}/${totalSchools}] Procesando ${schoolName}`)

            let simulatedProgress = 0
            const progressInterval = setInterval(() => {
              simulatedProgress += 5
              if (simulatedProgress <= 90) {
                // Dejar espacio para que se complete al 100% cuando termine realmente
                setGuardiansProgress((prev) =>
                  prev
                    ? {
                        ...prev,
                        currentStudent: Math.floor((simulatedProgress / 100) * (prev.totalStudents || 100)),
                      }
                    : null,
                )
              }
            }, 500)

            // Llamar a la función que procesa UNA escuela
            const result = await getGuardiansForSingleSchool(
              selectedIntegration.tenant_integration_id,
              schoolId,
              "powerschool",
            )

            clearInterval(progressInterval)

            if (result.success && result.guardians) {
              allGuardians.push(...result.guardians)
              setPowerschoolData([...allGuardians])

              console.log(
                `[v0] [${i + 1}/${totalSchools}] ${schoolName}: ${result.guardians.length} tutores (total acumulado: ${allGuardians.length})`,
              )

              setGuardiansProgress({
                currentSchool: schoolId,
                currentSchoolName: schoolName,
                schoolIndex: i + 1,
                totalSchools,
                currentStudent: result.studentCount || 0,
                totalStudents: result.studentCount || 1,
                totalGuardians: allGuardians.length,
                isLoadingComplete: false,
              })
            } else {
              console.error(`[v0] Error en escuela ${schoolName}:`, result.error)
            }
          }

          setIsLoadingPowerschool(false)
          setGuardiansProgress(null)
          setPowerschoolData(allGuardians)
          console.log("[v0] Total tutores de PowerSchool cargados:", allGuardians.length)

          if (tenantId) {
            loadCometaGuardians(tenantId)
          }
        } catch (err) {
          setIsLoadingPowerschool(false)
          setGuardiansProgress(null)
          setError("Error al obtener tutores de PowerSchool")
          console.error("[v0] Error loading PowerSchool guardians:", err)
        }

        setSchoolsProgress([])
      }
    } catch (err) {
      const dataTypeLabel = type === "students" ? "estudiantes" : "tutores"
      setError(`Error al obtener los ${dataTypeLabel}`)
      setIsLoadingPowerschool(false)
      setSchoolsProgress([])
      setGuardiansProgress(null)
    }
  }

  const loadCometaGuardians = async (tenant_id: string) => {
    if (!selectedIntegration) return

    setIsLoadingCometa(true)
    setLoadingMessage("Cargando tutores de Cometa...")

    try {
      const result = await getCometaGuardians(selectedIntegration.tenant_integration_id, tenant_id, selectedSchools)

      setIsLoadingCometa(false)
      if (result.success && result.guardians) {
        setCometaData(result.guardians)
        console.log("[v0] Cometa guardians loaded:", result.guardians.length)
      } else {
        console.error("[v0] Error loading Cometa guardians:", result.error)
      }
    } catch (err) {
      setIsLoadingCometa(false)
      console.error("[v0] Error loading Cometa guardians:", err)
    }
  }

  const handleStartMatch = async (rules: MatchRule[]) => {
    console.log("[v0] handleStartMatch called")
    console.log("[v0] tenantId:", tenantId)
    console.log("[v0] selectedIntegration:", selectedIntegration)
    console.log("[v0] powerschoolData.length:", powerschoolData.length)
    console.log("[v0] cometaData.length:", cometaData.length)
    console.log("[v0] dataType:", dataType)

    if (!selectedIntegration) {
      setError("No se ha seleccionado una integración")
      return
    }

    if (!tenantId) {
      setError("No se pudo obtener el ID del tenant")
      return
    }

    if (dataType === "guardians") {
      if (powerschoolData.length === 0) {
        setError("No se han cargado tutores de PowerSchool")
        return
      }
      if (cometaData.length === 0) {
        setError("No se han cargado tutores de Cometa")
        return
      }
    } else if (dataType === "students") {
      if (powerschoolData.length === 0) {
        setError("No se han cargado estudiantes")
        return
      }
    }

    if (!dataType) {
      setError("No se ha seleccionado el tipo de datos")
      return
    }

    setView("loading")
    setError(null)

    try {
      if (dataType === "students") {
        setLoadingMessage("Comparando estudiantes de PowerSchool con Cometa...")

        const result = await performMatching(
          selectedIntegration.tenant_integration_id,
          tenantId,
          powerschoolData,
          rules,
        )

        if (!result.success || !result.results) {
          setError(result.error || "Error durante el matching")
          setView("matchConfig")
          return
        }

        setMatchResults(result.results)
        setView("matchResults")
      } else if (dataType === "guardians") {
        setLoadingMessage("Comparando tutores de PowerSchool con Cometa...")
        console.log(
          "[v0] Starting guardian matching with PowerSchool:",
          powerschoolData.length,
          "Cometa:",
          cometaData.length,
        )

        const result = await performGuardiansMatching(
          selectedIntegration.tenant_integration_id,
          tenantId,
          selectedSchools,
          powerschoolData,
          rules,
        )

        if (!result.success || !result.results) {
          console.error("[v0] Guardian matching failed:", result.error)
          setError(result.error || "Error durante el matching de tutores")
          setView("matchConfig")
          return
        }

        console.log("[v0] Guardian matching successful, results:", result.results.length)
        setMatchResults(result.results)
        setView("matchResults")
      }
    } catch (err) {
      console.error("[v0] Error en handleStartMatch:", err)
      setError("Error inesperado durante el matching")
      setView("matchConfig")
    }
  }

  const handleReset = () => {
    setView("credentials")
    setJsonInput("")
    setFileName(null)
    setFileValidated(false)
    setError(null)
    setIntegrations(null)
    setSchools(null)
    setSelectedIntegration(null)
    setStudents([])
    setSchoolsProgress([])
    setDataType(null)
    setMatchResults([])
    setTenantId(null)
    setGuardiansProgress(null)
    setIsLoadingGuardians(false)
    setPowerschoolData([])
    setCometaData([])
    setIsLoadingPowerschool(false)
    setIsLoadingCometa(false)
  }

  const handleBackToIntegrations = () => {
    setView("integrations")
    setSchools(null)
    setSelectedIntegration(null)
    setError(null)
    setStudents([])
    setSchoolsProgress([])
    setGuardiansProgress(null)
    setIsLoadingGuardians(false)
    setPowerschoolData([])
    setCometaData([])
    setIsLoadingPowerschool(false)
    setIsLoadingCometa(false)
  }

  const handleToggleSchool = (schoolId: string) => {
    setSelectedSchools((prev) => (prev.includes(schoolId) ? prev.filter((id) => id !== schoolId) : [...prev, schoolId]))
  }

  const handleSelectAll = () => {
    if (schools) {
      setSelectedSchools(schools.map((s) => s.id))
    }
  }

  const handleDeselectAll = () => {
    setSelectedSchools([])
  }

  const handleBackToDataType = () => {
    setView("dataType")
    setStudents([])
    setError(null)
    setSchoolsProgress([])
    setGuardiansProgress(null)
    setIsLoadingGuardians(false)
    setPowerschoolData([])
    setCometaData([])
    setIsLoadingPowerschool(false)
    setIsLoadingCometa(false)
  }

  const handleBackToSchools = () => {
    setView("schools")
    setError(null)
  }

  const handleBackToMatchConfig = () => {
    setView("matchConfig")
    setError(null)
  }

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      processFile(file)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      processFile(file)
    }
  }

  if (view === "loading") {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Card className="border-neutral-200 bg-white shadow-sm w-full max-w-2xl">
          <CardContent className="flex flex-col items-center justify-center p-12 space-y-6">
            <Spinner className="h-12 w-12 text-galaxy-500" />
            <p className="text-lg font-medium text-neutral-900 font-lota text-center">{loadingMessage}</p>
            <p className="text-sm text-neutral-600 text-center">Por favor espere mientras procesamos su solicitud</p>

            {guardiansProgress && (
              <div className="w-full space-y-4 mt-6">
                <div className="bg-galaxy-50 border border-galaxy-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-galaxy-900">Progreso General</p>
                    <Badge className="bg-galaxy-100 text-galaxy-700 border-galaxy-300">
                      {Math.round(
                        ((guardiansProgress.schoolIndex - 1) * 100 +
                          (guardiansProgress.currentStudent / guardiansProgress.totalStudents) * 100) /
                          guardiansProgress.totalSchools,
                      )}
                      %
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-galaxy-700">
                        Escuela {guardiansProgress.schoolIndex} de {guardiansProgress.totalSchools}
                      </span>
                      <span className="text-galaxy-600 font-mono">
                        {guardiansProgress.currentStudent}/{guardiansProgress.totalStudents} estudiantes
                      </span>
                    </div>
                    <div className="w-full bg-galaxy-200 rounded-full h-2.5">
                      <div
                        className="bg-galaxy-500 h-2.5 rounded-full transition-all duration-300"
                        style={{
                          width: `${(guardiansProgress.currentStudent / guardiansProgress.totalStudents) * 100}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-galaxy-600 mt-2">
                      {guardiansProgress.totalGuardians} tutores únicos encontrados hasta ahora
                    </p>
                  </div>
                </div>
              </div>
            )}

            {schoolsProgress.length > 0 && (
              <div className="w-full space-y-3 mt-6">
                <p className="text-sm font-medium text-neutral-700 mb-3">Progreso de escuelas:</p>
                {schoolsProgress.map((school) => (
                  <div
                    key={school.id}
                    className="flex items-center justify-between p-3 bg-neutral-50 rounded-lg border border-neutral-200"
                  >
                    {school.status === "completed" && <CheckCircle2 className="h-5 w-5 text-success-500" />}
                    {school.status === "processing" && <Loader2 className="h-5 w-5 text-galaxy-500 animate-spin" />}
                    {school.status === "pending" && (
                      <div className="h-5 w-5 rounded-full border-2 border-neutral-300" />
                    )}
                    {school.status === "error" && (
                      <div className="h-5 w-5 rounded-full bg-error-500 flex items-center justify-center">
                        <span className="text-white text-xs font-bold">!</span>
                      </div>
                    )}
                    <span
                      className={`text-sm font-medium ${
                        school.status === "completed"
                          ? "text-success-700"
                          : school.status === "processing"
                            ? "text-galaxy-700"
                            : school.status === "error"
                              ? "text-error-700"
                              : "text-neutral-600"
                      }`}
                    >
                      {school.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (view === "credentials") {
    return (
      <Card className="border-neutral-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-neutral-900 font-lota text-2xl">Credenciales Encriptadas</CardTitle>
          <CardDescription className="text-neutral-600">
            Suba el archivo de credenciales para ver las integraciones y escuelas disponibles
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                isDragging
                  ? "border-galaxy-500 bg-galaxy-50"
                  : fileValidated
                    ? "border-success-500 bg-success-50"
                    : "border-neutral-300 hover:border-galaxy-400 hover:bg-galaxy-50 bg-transparent"
              }`}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {fileValidated ? (
                <>
                  <CheckCircle2 className="mx-auto h-12 w-12 mb-4 text-success-500" />
                  <p className="text-sm font-medium text-success-700 mb-2">Archivo validado correctamente</p>
                  <p className="text-xs text-success-600 mb-4">{fileName}</p>
                  <p className="text-xs text-neutral-500">Validando credenciales...</p>
                </>
              ) : (
                <>
                  <Upload className={`mx-auto h-12 w-12 mb-4 ${isDragging ? "text-galaxy-500" : "text-neutral-400"}`} />
                  <p className="text-sm font-medium text-neutral-900 mb-2">
                    Arrastre su archivo aquí o haga clic para seleccionar
                  </p>
                  <p className="text-xs text-neutral-500 mb-4">Archivos .txt o .json con las credenciales</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-neutral-300 hover:border-galaxy-500 hover:bg-galaxy-50 bg-transparent"
                    onClick={() => document.getElementById("fileUpload")?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Elegir Archivo
                  </Button>
                  {fileName && !fileValidated && (
                    <p className="text-sm text-galaxy-600 font-medium mt-3">Archivo seleccionado: {fileName}</p>
                  )}
                </>
              )}
              <input id="fileUpload" type="file" accept=".txt,.json" onChange={handleFileUpload} className="hidden" />
            </div>

            {error && (
              <Alert variant="destructive" className="border-error-300 bg-error-50">
                <AlertDescription className="text-error-700">{error}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (view === "integrations") {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={handleReset}
          className="text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a Credenciales
        </Button>

        <Card className="border-neutral-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-neutral-900 font-lota text-2xl">Integraciones Disponibles</CardTitle>
            <CardDescription className="text-neutral-600">
              Seleccione una integración para ver las escuelas
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="border-error-300 bg-error-50 mb-4">
                <AlertDescription className="text-error-700">{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              {integrations?.map((integration) => (
                <Card
                  key={integration.tenant_integration_id}
                  className="border-2 border-neutral-200 hover:border-galaxy-300 transition-colors cursor-pointer"
                  onClick={() => handleGetSchools(integration)}
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <h3 className="font-semibold text-neutral-900 font-lota">{integration.name}</h3>
                      <p className="text-sm text-neutral-600">
                        Partner: <span className="font-medium">{integration.partner}</span>
                      </p>
                      <p className="text-xs text-neutral-500 font-mono">ID: {integration.tenant_integration_id}</p>
                    </div>
                    <Button className="bg-galaxy-500 hover:bg-galaxy-600 text-white">Ver Escuelas</Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (view === "schools") {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={handleBackToIntegrations}
          className="text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a Integraciones
        </Button>

        <Card className="border-neutral-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-neutral-900 font-lota text-2xl">Escuelas Disponibles</CardTitle>
            <CardDescription className="text-neutral-600">
              Seleccione las escuelas de las cuales desea obtener información. Recomendamos seleccionar todas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive" className="border-error-300 bg-error-50">
                <AlertDescription className="text-error-700">{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between p-4 bg-aurora-50 border border-aurora-200 rounded-lg">
              <div className="space-y-1">
                <p className="text-sm font-medium text-neutral-900">
                  {selectedSchools.length} de {schools?.length || 0} escuelas seleccionadas
                </p>
                <p className="text-xs text-neutral-600">Recomendamos seleccionar todas las escuelas</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAll}
                  className="border-neutral-300 hover:border-galaxy-500 hover:bg-galaxy-50 bg-transparent"
                >
                  Seleccionar Todas
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeselectAll}
                  className="border-neutral-300 hover:border-error-500 hover:bg-error-50 bg-transparent"
                >
                  Deseleccionar Todas
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {schools?.map((school) => (
                <Card
                  key={school.id}
                  className={`border-2 transition-all cursor-pointer ${
                    selectedSchools.includes(school.id)
                      ? "border-galaxy-400 bg-galaxy-50"
                      : "border-neutral-200 hover:border-galaxy-300"
                  }`}
                  onClick={() => handleToggleSchool(school.id)}
                >
                  <CardContent className="flex items-start gap-3 p-4">
                    <Checkbox
                      checked={selectedSchools.includes(school.id)}
                      onCheckedChange={() => handleToggleSchool(school.id)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <h3 className="font-semibold text-neutral-900 font-lota">{school.name}</h3>
                      <p className="text-sm text-neutral-600 font-mono">ID: {school.id}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Button
              onClick={handleSchoolsSelected}
              disabled={selectedSchools.length === 0}
              className="w-full bg-galaxy-500 hover:bg-galaxy-600 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continuar con {selectedSchools.length} {selectedSchools.length === 1 ? "escuela" : "escuelas"}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (view === "dataType") {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={handleBackToSchools}
          className="text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a Escuelas
        </Button>

        <Card className="border-neutral-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-neutral-900 font-lota text-2xl">Seleccione el Tipo de Datos</CardTitle>
            <CardDescription className="text-neutral-600">
              ¿Qué información desea obtener de las {selectedSchools.length}{" "}
              {selectedSchools.length === 1 ? "escuela seleccionada" : "escuelas seleccionadas"}?
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="border-error-300 bg-error-50 mb-4">
                <AlertDescription className="text-error-700">{error}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <Card
                className="border-2 border-neutral-200 hover:border-galaxy-400 hover:bg-galaxy-50 transition-all cursor-pointer group"
                onClick={() => handleSelectDataType("students")}
              >
                <CardContent className="flex flex-col items-center justify-center p-8 space-y-4">
                  <div className="h-16 w-16 rounded-full bg-galaxy-100 group-hover:bg-galaxy-200 flex items-center justify-center transition-colors">
                    <Users className="h-8 w-8 text-galaxy-600" />
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="font-semibold text-lg text-neutral-900 font-lota">Estudiantes</h3>
                    <p className="text-sm text-neutral-600">
                      Obtener la lista de estudiantes de las escuelas seleccionadas
                    </p>
                  </div>
                  <Button className="w-full bg-galaxy-500 hover:bg-galaxy-600 text-white">
                    Seleccionar Estudiantes
                  </Button>
                </CardContent>
              </Card>

              <Card
                className="border-2 border-neutral-200 hover:border-aurora-400 hover:bg-aurora-50 transition-all cursor-pointer group"
                onClick={() => handleSelectDataType("guardians")}
              >
                <CardContent className="flex flex-col items-center justify-center p-8 space-y-4">
                  <div className="h-16 w-16 rounded-full bg-aurora-100 group-hover:bg-aurora-200 flex items-center justify-center transition-colors">
                    <UserCheck className="h-8 w-8 text-aurora-600" />
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="font-semibold text-lg text-neutral-900 font-lota">Tutores</h3>
                    <p className="text-sm text-neutral-600">
                      Obtener la lista de tutores/padres de las escuelas seleccionadas
                    </p>
                  </div>
                  <Button className="w-full bg-aurora-500 hover:bg-aurora-600 text-white">Seleccionar Tutores</Button>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (view === "matchConfig") {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={handleBackToDataType}
          className="text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>

        {error && (
          <Alert variant="destructive" className="border-error-300 bg-error-50">
            <AlertDescription className="text-error-700">{error}</AlertDescription>
          </Alert>
        )}

        {isLoadingPowerschool && guardiansProgress && (
          <Card className="border-galaxy-200 bg-galaxy-50">
            <CardHeader>
              <CardTitle className="text-galaxy-900 font-lota text-lg flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Cargando Tutores de PowerSchool
              </CardTitle>
              <CardDescription className="text-galaxy-700">
                Obteniendo tutores del sistema PowerSchool...
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-white border border-galaxy-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-galaxy-900">Progreso de Carga</p>
                  <Badge className="bg-galaxy-100 text-galaxy-700 border-galaxy-300">
                    {guardiansProgress.totalSchools > 0
                      ? Math.round(
                          ((guardiansProgress.schoolIndex - 1) / guardiansProgress.totalSchools) * 100 +
                            (guardiansProgress.totalStudents > 0
                              ? (guardiansProgress.currentStudent / guardiansProgress.totalStudents) *
                                (100 / guardiansProgress.totalSchools)
                              : 0),
                        )
                      : 0}
                    %
                  </Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-galaxy-700">
                      Escuela {guardiansProgress.schoolIndex} de {guardiansProgress.totalSchools}
                    </span>
                    <span className="text-galaxy-600 font-mono">
                      {guardiansProgress.currentStudent}/{guardiansProgress.totalStudents} estudiantes
                    </span>
                  </div>
                  <div className="w-full bg-galaxy-200 rounded-full h-2.5">
                    <div
                      className="bg-galaxy-500 h-2.5 rounded-full transition-all duration-300"
                      style={{
                        /* Calcular ancho seguro evitando división por 0 */
                        width: `${guardiansProgress.totalStudents > 0 ? (guardiansProgress.currentStudent / guardiansProgress.totalStudents) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <p className="text-sm font-semibold text-galaxy-800 mt-3">
                    {powerschoolData.length} tutores únicos de PowerSchool cargados
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoadingCometa && (
          <Card className="border-aurora-200 bg-aurora-50">
            <CardHeader>
              <CardTitle className="text-aurora-900 font-lota text-lg flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Cargando Tutores de Cometa
              </CardTitle>
              <CardDescription className="text-aurora-700">Obteniendo tutores del sistema Cometa...</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-white border border-aurora-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-aurora-800">
                  {cometaData.length} tutores únicos de Cometa cargados
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {!isLoadingPowerschool && !isLoadingCometa && powerschoolData.length > 0 && (
          <Card className="border-success-200 bg-success-50">
            <CardHeader>
              <CardTitle className="text-success-900 font-lota text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                Datos Cargados Correctamente
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-white border border-success-200 rounded-lg">
                <span className="text-sm font-medium text-success-900">PowerSchool:</span>
                <Badge className="bg-success-100 text-success-700 border-success-300">
                  {powerschoolData.length} {dataType === "students" ? "estudiantes" : "tutores"}
                </Badge>
              </div>
              {dataType === "guardians" && cometaData.length > 0 && (
                <div className="flex items-center justify-between p-3 bg-white border border-success-200 rounded-lg">
                  <span className="text-sm font-medium text-success-900">Cometa:</span>
                  <Badge className="bg-success-100 text-success-700 border-success-300">
                    {cometaData.length} tutores
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!isLoadingPowerschool && !isLoadingCometa && powerschoolData.length > 0 && dataType === "guardians" && (
          <StudentsTable students={powerschoolData} dataType="guardians" />
        )}

        <MatchConfig
          onBack={handleBackToDataType}
          onStartMatch={handleStartMatch}
          dataType={dataType || "students"}
          disabled={isLoadingPowerschool || (dataType === "guardians" && isLoadingCometa)}
        />
      </div>
    )
  }

  if (view === "matchResults") {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={handleBackToMatchConfig}
          className="text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a Configuración
        </Button>

        {error && (
          <Alert variant="destructive" className="border-error-300 bg-error-50">
            <AlertDescription className="text-error-700">{error}</AlertDescription>
          </Alert>
        )}

        <MatchResultsTable results={matchResults} dataType={dataType || "students"} />

        <div className="flex justify-end">
          <Button
            onClick={() => setView("discrepancyResolver")}
            className="bg-warning-500 hover:bg-warning-600 text-white"
          >
            Resolver Discrepancias
          </Button>
        </div>
      </div>
    )
  }

  if (view === "discrepancyResolver") {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={() => setView("matchResults")}
          className="text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a Resultados
        </Button>

        {error && (
          <Alert variant="destructive" className="border-error-300 bg-error-50">
            <AlertDescription className="text-error-700">{error}</AlertDescription>
          </Alert>
        )}

        <DiscrepancyResolver
          results={matchResults}
          onBack={() => setView("matchResults")}
          dataType={dataType || "students"}
        />
      </div>
    )
  }

  if (view === "students") {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={handleBackToDataType}
          className="text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a Selección de Tipo
        </Button>

        {error && (
          <Alert variant="destructive" className="border-error-300 bg-error-50">
            <AlertDescription className="text-error-700">{error}</AlertDescription>
          </Alert>
        )}

        <StudentsTable students={students} dataType={dataType || "students"} />
      </div>
    )
  }

  return null
}
