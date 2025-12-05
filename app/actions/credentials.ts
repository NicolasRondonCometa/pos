"use server"

import {
  createMatchSession,
  saveMatchResults,
  getMatchResults,
  getMatchedStudentsForComparison,
  saveGuardianComparisonResult,
  getGuardianComparisonResults,
  clearGuardianComparisonResults,
  cleanupOldSessions,
  getLatestSessionWithComparisonResults,
} from "@/lib/db"

const rawApiBaseUrl = (process.env.API_BASE_URL || "http://localhost").trim()
const API_BASE_URL =
  rawApiBaseUrl.startsWith("http://") || rawApiBaseUrl.startsWith("https://")
    ? rawApiBaseUrl
    : `https://${rawApiBaseUrl}`

const COMETA_AUTH_TOKEN = (process.env.COMETA_AUTH_TOKEN || "").trim()

const SCHOOLS_API_TOKEN = (process.env.SCHOOLS_API_TOKEN || "").trim()
const rawSchoolsApiBaseUrl = (process.env.SCHOOLS_API_BASE_URL || "schools.prd.getcometa.com").trim()
const SCHOOLS_API_BASE_URL =
  rawSchoolsApiBaseUrl.startsWith("http://") || rawSchoolsApiBaseUrl.startsWith("https://")
    ? rawSchoolsApiBaseUrl
    : `https://${rawSchoolsApiBaseUrl}`

if (SCHOOLS_API_BASE_URL.length > 100 || SCHOOLS_API_BASE_URL.includes("=")) {
  console.error("[v0] ⚠️ ERROR: SCHOOLS_API_BASE_URL parece ser un token, no una URL")
  console.error("[v0] Por favor, verifica las variables de entorno en la sección Vars del sidebar")
}

if (SCHOOLS_API_TOKEN && SCHOOLS_API_TOKEN.includes("schools.prd.getcometa")) {
  console.error("[v0] ⚠️ ERROR: SCHOOLS_API_TOKEN parece ser una URL, no un token")
  console.error("[v0] Por favor, verifica las variables de entorno en la sección Vars del sidebar")
}

interface EncryptedCredentials {
  iv: string
  data: string
}

interface Integration {
  tenant_integration_id: string
  name: string
  partner: string
  tenant_id: string
}

interface ValidateResponse {
  error: boolean
  message: string
  data?: {
    tenant_id: string
    integrations: Integration[]
  }
}

interface SchoolsResponse {
  error: boolean
  message: string
  data?: any[]
}

interface StudentsResponse {
  error: boolean
  message: string
  data?: any[]
}

export async function validateCredentials(credentials: EncryptedCredentials) {
  try {
    if (API_BASE_URL.includes("localhost") || API_BASE_URL.includes("127.0.0.1")) {
      console.warn(
        "[v0] WARNING: API_BASE_URL is set to localhost. This may not work in the v0 environment. Please use a public URL like ngrok.",
      )
    }

    if (!COMETA_AUTH_TOKEN) {
      console.error("[v0] COMETA_AUTH_TOKEN no está configurado")
      return {
        success: false,
        error:
          "Token de autenticación no configurado. Por favor, configura COMETA_AUTH_TOKEN en las variables de entorno.",
      }
    }

    const validateUrl = `${API_BASE_URL}/shared/api/v1/credentials/validate`
    console.log("[v0] API_BASE_URL:", API_BASE_URL)
    console.log("[v0] Full validate URL:", validateUrl)
    console.log("[v0] Credentials payload:", { iv: credentials.iv, data: credentials.data.substring(0, 20) + "..." })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    let validateResponse: Response
    try {
      validateResponse = await fetch(validateUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          Authorization: `Bearer ${COMETA_AUTH_TOKEN}`,
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
          "User-Agent": "v0-integration-app",
        },
        body: JSON.stringify({
          iv: credentials.iv,
          data: credentials.data,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
    } catch (fetchError) {
      clearTimeout(timeoutId)
      console.error("[v0] Fetch error:", fetchError)

      if (fetchError instanceof Error) {
        if (fetchError.name === "AbortError") {
          return {
            success: false,
            error: "La solicitud tardó demasiado tiempo. Verifica que la URL de la API sea accesible.",
          }
        }
        if (fetchError.message.includes("fetch")) {
          return {
            success: false,
            error: `No se pudo conectar con la API. Verifica que API_BASE_URL esté configurada correctamente. URL actual: ${API_BASE_URL}`,
          }
        }
      }
      throw fetchError
    }

    console.log("[v0] Response status:", validateResponse.status)
    console.log("[v0] Response headers:", Object.fromEntries(validateResponse.headers.entries()))

    const responseText = await validateResponse.text()
    console.log("[v0] Response text:", responseText.substring(0, 200))

    if (!validateResponse.ok) {
      let errorMessage = "Error al validar las credenciales"
      try {
        const errorData = JSON.parse(responseText)
        errorMessage = errorData.message || errorData.detail || errorMessage
      } catch {
        errorMessage = responseText || errorMessage
      }

      return {
        success: false,
        error: errorMessage,
      }
    }

    let validateData: ValidateResponse
    try {
      validateData = JSON.parse(responseText)
    } catch (parseError) {
      console.error("[v0] Failed to parse response as JSON:", parseError)
      return {
        success: false,
        error: "Formato de respuesta inválido del servidor",
      }
    }

    if (validateData.error) {
      return {
        success: false,
        error: validateData.message || "Error al validar las credenciales",
      }
    }

    return {
      success: true,
      integrations: validateData.data?.integrations || [],
      tenantId: validateData.data?.tenant_id,
    }
  } catch (error) {
    console.error("[v0] Error in validateCredentials:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Ocurrió un error inesperado al validar las credenciales",
    }
  }
}

export async function getSchools(tenantIntegrationId: string) {
  try {
    if (!COMETA_AUTH_TOKEN) {
      console.error("[v0] COMETA_AUTH_TOKEN no está configurado")
      return {
        success: false,
        error:
          "Token de autenticación no configurado. Por favor, configura COMETA_AUTH_TOKEN en las variables de entorno.",
      }
    }

    const schoolsUrl = `${API_BASE_URL}/external/api/v1/tenants/${tenantIntegrationId}/schools/pull/?partner=powerschool`
    console.log("[v0] Fetching schools from:", schoolsUrl)

    const schoolsResponse = await fetch(schoolsUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${COMETA_AUTH_TOKEN}`,
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "v0-integration-app",
      },
    })

    console.log("[v0] Schools response status:", schoolsResponse.status)

    if (!schoolsResponse.ok) {
      const responseText = await schoolsResponse.text()
      console.log("[v0] Schools error response:", responseText)

      let errorMessage = "Failed to fetch schools"
      try {
        const errorData = JSON.parse(responseText)
        errorMessage = errorData.message || errorData.detail || errorMessage
      } catch {
        errorMessage = responseText || errorMessage
      }

      return {
        success: false,
        error: errorMessage,
      }
    }

    const responseText = await schoolsResponse.text()
    console.log("[v0] Schools response text:", responseText.substring(0, 200))

    let schoolsData: SchoolsResponse
    try {
      schoolsData = JSON.parse(responseText)
    } catch (parseError) {
      console.error("[v0] Failed to parse schools response:", parseError)
      return {
        success: false,
        error: "Invalid response format from server",
      }
    }

    if (schoolsData.error || !schoolsData.data) {
      return {
        success: false,
        error: schoolsData.message || "No schools data available",
      }
    }

    return {
      success: true,
      schools: schoolsData.data,
    }
  } catch (error) {
    console.error("[v0] Error in getSchools:", error)
    return {
      success: false,
      error: "An unexpected error occurred while fetching schools",
    }
  }
}

export async function getStudents(tenantIntegrationId: string, schoolId: string) {
  try {
    if (!COMETA_AUTH_TOKEN) {
      console.error("[v0] COMETA_AUTH_TOKEN no está configurado")
      return {
        success: false,
        error:
          "Token de autenticación no configurado. Por favor, configura COMETA_AUTH_TOKEN en las variables de entorno.",
      }
    }

    const studentsUrl = `${API_BASE_URL}/external/api/v1/tenants/${tenantIntegrationId}/students/pull/?partner=powerschool&school_id=${schoolId}`
    console.log("[v0] Fetching students from:", studentsUrl)

    const studentsResponse = await fetch(studentsUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${COMETA_AUTH_TOKEN}`,
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "v0-integration-app",
      },
    })

    console.log("[v0] Students response status:", studentsResponse.status)

    if (!studentsResponse.ok) {
      const responseText = await studentsResponse.text()
      console.log("[v0] Students error response:", responseText)

      let errorMessage = "Error al obtener estudiantes"
      try {
        const errorData = JSON.parse(responseText)
        errorMessage = errorData.message || errorData.detail || errorMessage
      } catch {
        errorMessage = responseText || errorMessage
      }

      return {
        success: false,
        error: errorMessage,
      }
    }

    const responseText = await studentsResponse.text()
    console.log("[v0] Students response text:", responseText.substring(0, 200))

    let studentsData: StudentsResponse
    try {
      studentsData = JSON.parse(responseText)
    } catch (parseError) {
      console.error("[v0] Failed to parse students response:", parseError)
      return {
        success: false,
        error: "Formato de respuesta inválido del servidor",
      }
    }

    if (studentsData.error || !studentsData.data) {
      return {
        success: false,
        error: studentsData.message || "No hay datos de estudiantes disponibles",
      }
    }

    // Agregar school_id a cada estudiante
    const studentsWithSchoolId = studentsData.data.map((student: any) => ({
      ...student,
      school_id: schoolId,
    }))

    return {
      success: true,
      students: studentsWithSchoolId,
    }
  } catch (error) {
    console.error("[v0] Error in getStudents:", error)
    return {
      success: false,
      error: "Ocurrió un error inesperado al obtener estudiantes",
    }
  }
}

export async function getCometaStudents(
  tenantIntegrationId: string,
  tenantId: string,
  schoolIds: string[] = [],
  includeInactive: boolean = false,
) {
  try {
    if (!COMETA_AUTH_TOKEN) {
      console.error("[v0] COMETA_AUTH_TOKEN no está configurado")
      return {
        success: false,
        error:
          "Token de autenticación no configurado. Por favor, configura COMETA_AUTH_TOKEN en las variables de entorno.",
      }
    }

    const cometaUrl = `${API_BASE_URL}/external/api/v1/tenants/${tenantIntegrationId}/students/pull/?partner=schools&school_id=${tenantId}`
    console.log("[v0] Obteniendo estudiantes de Cometa desde:", cometaUrl)

    const cometaResponse = await fetch(cometaUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${COMETA_AUTH_TOKEN}`,
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "v0-integration-app",
      },
    })

    console.log("[v0] Respuesta de Cometa - status:", cometaResponse.status)

    if (!cometaResponse.ok) {
      const responseText = await cometaResponse.text()
      console.log("[v0] Error en respuesta de Cometa:", responseText)

      let errorMessage = "Error al obtener estudiantes de Cometa"
      try {
        const errorData = JSON.parse(responseText)
        errorMessage = errorData.message || errorData.detail || errorMessage
      } catch {
        errorMessage = responseText || errorMessage
      }

      return {
        success: false,
        error: `fetch to ${cometaUrl} failed with status ${cometaResponse.status} and body: ${errorMessage}`,
      }
    }

    const responseText = await cometaResponse.text()
    console.log("[v0] Respuesta de Cometa exitosa:", responseText.substring(0, 200))

    let cometaData: StudentsResponse
    try {
      cometaData = JSON.parse(responseText)
    } catch (parseError) {
      console.error("[v0] Error al parsear respuesta de Cometa:", parseError)
      return {
        success: false,
        error: "Formato de respuesta inválido del servidor de Cometa",
      }
    }

    if (cometaData.error || !cometaData.data) {
      return {
        success: false,
        error: cometaData.message || "No hay datos de estudiantes de Cometa disponibles",
      }
    }

    let students = cometaData.data
    console.log("[v0] ✅ Estudiantes de Cometa obtenidos:", students.length)

    // 🔴 FILTRAR estudiantes inactivos si no se solicitaron
    if (!includeInactive) {
      const originalCount = students.length
      students = students.filter((student) => {
        const state = (student.state || "").toLowerCase()
        return state === "active" || state === "activo" || state === ""
      })
      console.log(
        `[v0] 📊 Filtrado de inactivos: ${originalCount} → ${students.length} estudiantes (excluidos ${originalCount - students.length})`,
      )
    } else {
      console.log(`[v0] ℹ️ Incluir inactivos: SÍ - procesando todos los ${students.length} estudiantes`)
    }

    return {
      success: true,
      students: students,
    }
  } catch (error) {
    console.error("[v0] Error general en getCometaStudents:", error)
    return {
      success: false,
      error: "Ocurrió un error inesperado al obtener estudiantes de Cometa",
    }
  }
}

export interface MatchRule {
  id: string
  name: string
  description: string
  priority: number
  enabled: boolean
}

export interface MatchedStudent {
  partnerData: any
  cometaData: any | null
  matchStatus: "matched" | "only_partner" | "only_cometa" | "conflict_duplicate"
  matchReason: string | null
  confidence: number
}

export async function matchStudents(
  partnerStudents: any[],
  cometaStudents: any[],
  rules: MatchRule[],
): Promise<MatchedStudent[]> {
  const results: MatchedStudent[] = []
  const matchedCometaIds = new Set<string>()

  const sortedRules = rules.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority)

  console.log(
    "[v0] Matching students with rules:",
    sortedRules.map((r) => `${r.name} (priority: ${r.priority})`),
  )

  // 🔍 DEBUG: Ver si los estudiantes traen datos de tutores
  if (partnerStudents.length > 0) {
    const samplePartner = partnerStudents[0]
    console.log("[v0] 🔍 Sample PowerSchool student keys:", Object.keys(samplePartner))
    console.log("[v0] 🔍 PowerSchool student has guardians?", {
      guardians: samplePartner.guardians,
      contacts: samplePartner.contacts,
    })
  }
  if (cometaStudents.length > 0) {
    const sampleCometa = cometaStudents[0]
    console.log("[v0] 🔍 Sample Cometa student keys:", Object.keys(sampleCometa))
    console.log("[v0] 🔍 Cometa student has guardians?", {
      guardians: sampleCometa.guardians,
      guardians_data: sampleCometa.guardians_data,
    })
  }

  for (const partnerStudent of partnerStudents) {
    let matched = false
    let matchedCometaStudent: any = null
    let matchReason: string | null = null

    for (const rule of sortedRules) {
      if (matched) break

      if (rule.id === "matricula") {
        const partnerMatricula = normalizeMatricula(partnerStudent.local_id || "")
        console.log(`[v0] Checking matricula for student ${partnerStudent.local_id}: "${partnerMatricula}"`)

        if (partnerMatricula) {
          const cometaMatch = cometaStudents.find((cs) => {
            const cometaMatricula = normalizeMatricula(cs.enrollment_code || "")
            return cometaMatricula === partnerMatricula && !matchedCometaIds.has(cs.id || cs.student_id)
          })
          if (cometaMatch) {
            matched = true
            matchedCometaStudent = cometaMatch
            matchReason = "Matrícula"
            matchedCometaIds.add(cometaMatch.id || cometaMatch.student_id)
            console.log(`[v0] Match found by matricula: ${partnerMatricula}`)
          }
        }
      } else if (rule.id === "curp") {
        const partnerCurp = (partnerStudent.curp || "").toString().toUpperCase().trim()
        console.log(`[v0] Checking CURP for student ${partnerStudent.local_id}: "${partnerCurp}"`)

        if (partnerCurp) {
          const cometaMatch = cometaStudents.find((cs) => {
            const cometaCurp = (cs.identifier || "").toString().toUpperCase().trim()
            return cometaCurp === partnerCurp && !matchedCometaIds.has(cs.id || cs.student_id)
          })
          if (cometaMatch) {
            matched = true
            matchedCometaStudent = cometaMatch
            matchReason = "CURP"
            matchedCometaIds.add(cometaMatch.id || cometaMatch.student_id)
            console.log(`[v0] Match found by CURP: ${partnerCurp}`)
          }
        }
      } else if (rule.id === "name_dob") {
        const partnerFirstName = partnerStudent.first_name || partnerStudent.nombre || ""
        const partnerLastName = partnerStudent.last_name || partnerStudent.apellido || ""
        const partnerFullName = normalizeFullName(partnerFirstName, partnerLastName)
        const partnerDob = normalizeDate(partnerStudent.dob || partnerStudent.fecha_nacimiento || "")

        console.log(
          `[v0] Checking name+DOB for student ${partnerStudent.local_id}: "${partnerFullName}" / "${partnerDob}"`,
        )

        if (partnerFullName && partnerDob) {
          const cometaMatch = cometaStudents.find((cs) => {
            const cometaFirstName = cs.first_name || cs.nombre || ""
            const cometaLastName = cs.last_name || cs.apellido || ""
            const cometaFullName = normalizeFullName(cometaFirstName, cometaLastName)
            const cometaDob = normalizeDate(cs.birthdate || cs.fecha_nacimiento || "")

            return (
              cometaFullName === partnerFullName &&
              cometaDob === partnerDob &&
              !matchedCometaIds.has(cs.id || cs.student_id)
            )
          })
          if (cometaMatch) {
            matched = true
            matchedCometaStudent = cometaMatch
            matchReason = "Nombre + Fecha de Nacimiento"
            matchedCometaIds.add(cometaMatch.id || cometaMatch.student_id)
            console.log(`[v0] Match found by name+DOB: ${partnerFullName} / ${partnerDob}`)
          }
        }
      }
    }

    results.push({
      partnerData: partnerStudent,
      cometaData: matchedCometaStudent,
      matchStatus: matched ? "matched" : "only_partner",
      matchReason,
      confidence: matched ? 1.0 : 0.0,
    })
  }

  for (const cometaStudent of cometaStudents) {
    const cometaId = cometaStudent.id || cometaStudent.student_id
    if (!matchedCometaIds.has(cometaId)) {
      results.push({
        partnerData: null,
        cometaData: cometaStudent,
        matchStatus: "only_cometa",
        matchReason: null,
        confidence: 0.0,
      })
    }
  }

  console.log("[v0] Matching complete. Total results:", results.length)
  console.log("[v0] Matched:", results.filter((r) => r.matchStatus === "matched").length)
  console.log("[v0] Only partner:", results.filter((r) => r.matchStatus === "only_partner").length)
  console.log("[v0] Only cometa:", results.filter((r) => r.matchStatus === "only_cometa").length)

  const matchReasons = results
    .filter((r) => r.matchReason)
    .reduce(
      (acc, r) => {
        acc[r.matchReason!] = (acc[r.matchReason!] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )
  console.log("[v0] Match reasons distribution:", matchReasons)

  return results
}

export async function performMatching(
  tenantIntegrationId: string,
  tenantId: string,
  partnerStudents: any[],
  rules: MatchRule[],
  includeInactive: boolean = false,
): Promise<{ success: boolean; results?: MatchedStudent[]; sessionId?: string; error?: string }> {
  try {
    console.log("[v0] Iniciando matching en el servidor...")
    console.log("[v0] Total estudiantes de PowerSchool recibidos:", partnerStudents.length)
    console.log("[v0] Incluir estudiantes inactivos:", includeInactive)

    // Limpiar sesiones antiguas
    cleanupOldSessions()

    const cometaResult = await getCometaStudents(tenantIntegrationId, tenantId, [], includeInactive)
    if (!cometaResult.success || !cometaResult.students) {
      return {
        success: false,
        error: cometaResult.error || "Error al obtener estudiantes de Cometa",
      }
    }

    console.log("[v0] Total estudiantes de Cometa:", cometaResult.students.length)

    const results = await matchStudents(partnerStudents, cometaResult.students, rules)

    console.log("[v0] Matching completado exitosamente")
    console.log("[v0] Total resultados:", results.length)

    // Guardar resultados en SQLite
    const sessionId = createMatchSession(tenantIntegrationId, tenantId, "students")
    saveMatchResults(sessionId, results)
    console.log("[v0] Resultados guardados en SQLite con sessionId:", sessionId)

    return {
      success: true,
      results,
      sessionId,
    }
  } catch (error) {
    console.error("[v0] Error en performMatching:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Ocurrió un error inesperado durante el matching",
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  initialDelayMs = 1000,
): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[v0] Fetch attempt ${attempt + 1}/${maxRetries + 1}: ${url}`)

      const response = await fetch(url, options)

      // Si recibimos 429 (Too Many Requests), reintentamos con backoff
      if (response.status === 429) {
        if (attempt < maxRetries) {
          const delayMs = initialDelayMs * Math.pow(2, attempt)
          console.log(`[v0] Rate limited (429). Retrying in ${delayMs}ms...`)
          await delay(delayMs)
          continue
        }
      }

      return response
    } catch (error) {
      lastError = error as Error
      console.error(`[v0] Fetch error on attempt ${attempt + 1}:`, error)

      if (attempt < maxRetries) {
        const delayMs = initialDelayMs * Math.pow(2, attempt)
        console.log(`[v0] Retrying in ${delayMs}ms...`)
        await delay(delayMs)
      }
    }
  }

  throw lastError || new Error("Max retries exceeded")
}

export async function getGuardians(tenantIntegrationId: string, studentId: string, schoolId: string, partner: string) {
  try {
    if (!COMETA_AUTH_TOKEN) {
      console.error("[v0] COMETA_AUTH_TOKEN no está configurado")
      return {
        success: false,
        error:
          "Token de autenticación no configurado. Por favor, configura COMETA_AUTH_TOKEN en las variables de entorno.",
      }
    }

    const guardiansUrl = `${API_BASE_URL}/external/api/v1/tenants/${tenantIntegrationId}/guardians/pull/?student_id=${studentId}&partner=${partner}&school_id=${schoolId}`

    const guardiansResponse = await fetchWithRetry(guardiansUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${COMETA_AUTH_TOKEN}`,
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "v0-integration-app",
      },
    })

    console.log("[v0] Guardians response status:", guardiansResponse.status)

    const responseText = await guardiansResponse.text()

    if (responseText.includes("Too Many Requests") || responseText.startsWith("<!DOCTYPE")) {
      console.log("[v0] Guardians response is HTML (rate limited):", responseText.substring(0, 100))
      return {
        success: false,
        error: "Rate limited by server",
      }
    }

    if (!guardiansResponse.ok) {
      console.log("[v0] Guardians error response:", responseText)

      let errorMessage = "Error al obtener tutores"
      try {
        const errorData = JSON.parse(responseText)
        errorMessage = errorData.message || errorData.detail || errorMessage
      } catch {
        errorMessage = responseText || errorMessage
      }

      return {
        success: false,
        error: errorMessage,
      }
    }

    let guardiansData: any
    try {
      guardiansData = JSON.parse(responseText)
    } catch (parseError) {
      console.error("[v0] Failed to parse guardians response:", parseError)
      console.log("[v0] Response text:", responseText.substring(0, 200))
      return {
        success: false,
        error: "Formato de respuesta inválido del servidor",
      }
    }

    if (guardiansData.error || !guardiansData.data) {
      return {
        success: false,
        error: guardiansData.message || "No hay datos de tutores disponibles",
      }
    }

    return {
      success: true,
      guardians: guardiansData.data,
    }
  } catch (error) {
    console.error("[v0] Error in getGuardians:", error)
    return {
      success: false,
      error: "Ocurrió un error inesperado al obtener tutores",
    }
  }
}

export async function getAllGuardiansForSchools(
  tenantIntegrationId: string,
  schoolIds: string[],
  partner: string,
): Promise<{ success: boolean; guardians?: any[]; error?: string }> {
  try {
    console.log("[v0] Obteniendo tutores para", schoolIds.length, "escuelas")

    const allGuardians: any[] = []
    const guardiansMap = new Map<string, any>()

    const DELAY_BETWEEN_REQUESTS_MS = 250

    for (let schoolIndex = 0; schoolIndex < schoolIds.length; schoolIndex++) {
      const schoolId = schoolIds[schoolIndex]

      const studentsResult = await getStudents(tenantIntegrationId, schoolId)
      if (!studentsResult.success || !studentsResult.students) {
        console.error(`[v0] Error obteniendo estudiantes de escuela ${schoolId}`)
        continue
      }

      const students = studentsResult.students
      const schoolName = `Escuela ${schoolIndex + 1}`

      console.log(`[v0] Procesando ${students.length} estudiantes de ${schoolName}`)

      for (let studentIndex = 0; studentIndex < students.length; studentIndex++) {
        const student = students[studentIndex]
        const studentId = student.id || student.student_id

        console.log(
          `[v0] Progreso: Escuela ${schoolIndex + 1}/${schoolIds.length}, Estudiante ${studentIndex + 1}/${students.length}`,
        )

        if (studentIndex > 0) {
          await delay(DELAY_BETWEEN_REQUESTS_MS)
        }

        const guardiansResult = await getGuardians(tenantIntegrationId, studentId, schoolId, partner)

        if (guardiansResult.success && guardiansResult.guardians) {
          for (const guardian of guardiansResult.guardians) {
            const guardianId = guardian.id || guardian.guardian_id || guardian.email || guardian.phone
            const studentInfo = {
              student_id: studentId,
              student_name: `${student.first_name || ""} ${student.last_name || ""}`.trim() || "-",
              student_local_id: student.local_id || student.student_number || "-",
            }
            
            if (guardianId) {
              if (!guardiansMap.has(guardianId)) {
                guardiansMap.set(guardianId, {
                  ...guardian,
                  students: [studentInfo], // Array de estudiantes
                  school_id: schoolId,
                })
              } else {
                // Agregar este estudiante a la lista de estudiantes del tutor
                const existingGuardian = guardiansMap.get(guardianId)
                if (!existingGuardian.students.some((s: any) => s.student_id === studentId)) {
                  existingGuardian.students.push(studentInfo)
                }
              }
            }
          }

          console.log(`[v0] Total tutores únicos hasta ahora: ${guardiansMap.size}`)
        }
      }
    }

    allGuardians.push(...Array.from(guardiansMap.values()))

    console.log("[v0] Total tutores únicos obtenidos:", allGuardians.length)

    return {
      success: true,
      guardians: allGuardians,
    }
  } catch (error) {
    console.error("[v0] Error in getAllGuardiansForSchools:", error)
    return {
      success: false,
      error: "Ocurrió un error inesperado al obtener tutores",
    }
  }
}

export async function getCometaGuardians(
  tenantIntegrationId: string,
  tenantId: string,
  schoolIds: string[],
  includeInactive: boolean = false,
): Promise<{ success: boolean; guardians?: any[]; error?: string }> {
  try {
    console.log("[v0] ========== INICIO: Obteniendo tutores de Cometa ==========")
    console.log("[v0] Environment check:")
    console.log("[v0]   - NODE_ENV:", process.env.NODE_ENV)
    console.log("[v0]   - SCHOOLS_API_BASE_URL:", SCHOOLS_API_BASE_URL)
    console.log("[v0]   - SCHOOLS_API_TOKEN (primeros 10 chars):", SCHOOLS_API_TOKEN.substring(0, 10) + "...")
    console.log("[v0]   - tenantIntegrationId:", tenantIntegrationId)
    console.log("[v0]   - tenantId:", tenantId)
    console.log("[v0]   - schoolIds:", schoolIds)
    console.log("[v0]   - includeInactive:", includeInactive)

    if (!SCHOOLS_API_TOKEN) {
      const errorMsg = "SCHOOLS_API_TOKEN no está configurado en las variables de entorno de producción"
      console.error("[v0] ❌", errorMsg)
      return {
        success: false,
        error: errorMsg,
      }
    }

    if (!SCHOOLS_API_BASE_URL || SCHOOLS_API_BASE_URL === "https://") {
      const errorMsg = "SCHOOLS_API_BASE_URL no está configurado correctamente en producción"
      console.error("[v0] ❌", errorMsg)
      return {
        success: false,
        error: errorMsg,
      }
    }

    // Primero necesitamos obtener todos los estudiantes de Cometa para luego obtener sus tutores
    console.log("[v0] Paso 1: Obteniendo estudiantes de Cometa...")
    const cometaStudentsResult = await getCometaStudents(tenantIntegrationId, tenantId, schoolIds, includeInactive)

    if (!cometaStudentsResult.success) {
      console.error("[v0] ❌ Error al obtener estudiantes de Cometa:", cometaStudentsResult.error)
      return {
        success: false,
        error: cometaStudentsResult.error || "Error al obtener estudiantes de Cometa",
      }
    }

    if (!cometaStudentsResult.students || cometaStudentsResult.students.length === 0) {
      console.warn("[v0] ⚠️ No se encontraron estudiantes en Cometa")
      return {
        success: true,
        guardians: [],
      }
    }

    const students = cometaStudentsResult.students
    console.log("[v0] ✅ Estudiantes de Cometa obtenidos:", students.length)

    // Procesar todos los estudiantes
    const studentsToProcess = students
    console.log(`[v0] Procesando ${studentsToProcess.length} estudiantes`)

    const allGuardians: any[] = []
    const guardiansMap = new Map<string, any>()
    let successfulRequests = 0
    let failedRequests = 0

    // Obtener tutores para cada estudiante usando el endpoint de Schools API
    console.log("[v0] Paso 2: Obteniendo tutores de cada estudiante...")

    for (let i = 0; i < studentsToProcess.length; i++) {
      const student = studentsToProcess[i]
      const studentId = student.id || student.student_id

      if (!studentId) {
        console.warn(`[v0] ⚠️ Estudiante ${i + 1} sin ID, saltando:`, student)
        continue
      }

      const guardiansUrl = `${SCHOOLS_API_BASE_URL}/api/v1/students/${studentId}/guardians`

      const progress = `${i + 1}/${studentsToProcess.length}`
      console.log(`[v0] [${progress}] Consultando tutores del estudiante ${studentId}`)
      console.log(`[v0] [${progress}] URL completa: ${guardiansUrl}`)

      try {
        const response = await fetch(guardiansUrl, {
          method: "GET",
          headers: {
            accept: "application/json",
            Authorization: `Bearer ${SCHOOLS_API_TOKEN}`,
            "User-Agent": "v0-integration-app",
          },
        })

        console.log(`[v0] [${progress}] Response status: ${response.status}`)

        if (response.ok) {
          const responseText = await response.text()
          let guardiansData: any

          try {
            guardiansData = JSON.parse(responseText)
          } catch (parseError) {
            console.error(`[v0] [${progress}] ❌ Error parseando JSON:`, parseError)
            console.error(`[v0] [${progress}] Response text:`, responseText.substring(0, 200))
            failedRequests++
            continue
          }

          // La respuesta puede ser un array directamente o un objeto con data
          let guardians: any[] = []
          if (Array.isArray(guardiansData)) {
            guardians = guardiansData
          } else if (guardiansData.data && Array.isArray(guardiansData.data)) {
            guardians = guardiansData.data
          } else {
            console.warn(`[v0] [${progress}] ⚠️ Formato de respuesta inesperado:`, guardiansData)
          }

          // Agregar tutores únicos al mapa
          let newGuardiansCount = 0
          for (const guardian of guardians) {
            const guardianId = guardian.id || guardian.email || guardian.phone
            const studentInfo = {
              student_id: studentId,
              student_name: `${student.first_name || ""} ${student.last_name || ""}`.trim() || "-",
              student_identifier: student.identifier || student.enrollment_code || "-",
            }
            
            if (guardianId) {
              if (!guardiansMap.has(guardianId)) {
                guardiansMap.set(guardianId, {
                  ...guardian,
                  students: [studentInfo], // Array de estudiantes
                })
                newGuardiansCount++
              } else {
                // Agregar este estudiante a la lista del tutor
                const existingGuardian = guardiansMap.get(guardianId)
                if (!existingGuardian.students.some((s: any) => s.student_id === studentId)) {
                  existingGuardian.students.push(studentInfo)
                }
              }
            }
          }

          successfulRequests++
          console.log(`[v0] [${progress}] ✅ ${newGuardiansCount} nuevos tutores (total único: ${guardiansMap.size})`)
        } else {
          const errorText = await response.text()
          console.error(`[v0] [${progress}] ❌ Error HTTP ${response.status}:`, errorText.substring(0, 200))
          failedRequests++

          if (failedRequests > 10 && successfulRequests === 0) {
            console.error("[v0] ❌ Demasiados errores consecutivos, deteniendo proceso")
            return {
              success: false,
              error: `Error en endpoint de Schools API. Última respuesta: ${response.status} - ${errorText.substring(0, 100)}`,
            }
          }
        }
      } catch (error) {
        console.error(`[v0] [${progress}] ❌ Error en request:`, error)
        failedRequests++
      }

      // Pequeño delay para evitar rate limiting
      if (i < studentsToProcess.length - 1) {
        await delay(200)
      }
    }

    allGuardians.push(...Array.from(guardiansMap.values()))

    console.log("[v0] ========== FIN: Resumen de obtención de tutores ==========")
    console.log(`[v0] Estudiantes procesados: ${studentsToProcess.length}`)
    console.log("[v0] Requests exitosos:", successfulRequests)
    console.log("[v0] Requests fallidos:", failedRequests)
    console.log("[v0] Total tutores únicos:", allGuardians.length)
    console.log("[v0] ============================================================")

    // 🔴 OPTIMIZACIÓN: Reducir el tamaño de los datos enviados al cliente
    // Solo enviar campos MÍNIMOS necesarios para matching
    const slimGuardians = allGuardians.map((guardian) => ({
      id: guardian.id,
      first_name: guardian.first_name,
      last_name: guardian.last_name,
      email: guardian.email,
      phone: guardian.phone,
      // También incluir variantes de nombres que usa el matching
      nombre: guardian.nombre,
      apellido: guardian.apellido,
      phone_number: guardian.phone_number,
      // Incluir información de TODOS los estudiantes asociados
      students: guardian.students || [],
    }))

    console.log(`[v0] 📦 Datos optimizados: ${allGuardians.length} tutores de Cometa -> reducidos a campos mínimos`)

    return {
      success: true,
      guardians: slimGuardians,
    }
  } catch (error) {
    console.error("[v0] ❌ Error crítico en getCometaGuardians:", error)
    console.error("[v0] Error stack:", error instanceof Error ? error.stack : "No stack trace")
    return {
      success: false,
      error:
        error instanceof Error ? `Error crítico: ${error.message}` : "Error inesperado al obtener tutores de Cometa",
    }
  }
}

export async function performGuardiansMatching(
  tenantIntegrationId: string,
  tenantId: string,
  schoolIds: string[],
  partnerGuardians: any[],
  cometaGuardians: any[], // 🔴 Ahora recibe los datos de Cometa directamente
  rules: MatchRule[],
): Promise<{ success: boolean; results?: MatchedStudent[]; error?: string }> {
  try {
    console.log("[v0] Iniciando matching de tutores en el servidor...")
    console.log("[v0] tenantIntegrationId:", tenantIntegrationId)
    console.log("[v0] tenantId:", tenantId)
    console.log("[v0] schoolIds:", schoolIds)
    console.log("[v0] Total tutores de PowerSchool recibidos:", partnerGuardians.length)
    console.log("[v0] Total tutores de Cometa recibidos:", cometaGuardians.length)
    console.log("[v0] Sample partner guardian:", partnerGuardians[0])
    console.log("[v0] Sample cometa guardian:", cometaGuardians[0])

    // ✅ Ya no llamamos a getCometaGuardians, usamos los datos recibidos
    const results = await matchGuardians(partnerGuardians, cometaGuardians, rules)

    console.log("[v0] Matching de tutores completado exitosamente")
    console.log("[v0] Total resultados:", results.length)

    return {
      success: true,
      results,
    }
  } catch (error) {
    console.error("[v0] Error en performGuardiansMatching:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Ocurrió un error inesperado durante el matching de tutores",
    }
  }
}

async function matchGuardians(
  partnerGuardians: any[],
  cometaGuardians: any[],
  rules: MatchRule[],
): Promise<MatchedStudent[]> {
  const results: MatchedStudent[] = []
  const matchedCometaIds = new Set<string>()

  const sortedRules = rules.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority)

  console.log(
    "[v0] Matching guardians with rules:",
    sortedRules.map((r) => `${r.name} (priority: ${r.priority})`),
  )

  // 🔴 DEBUG: Ver estructura de los primeros tutores
  if (partnerGuardians.length > 0) {
    console.log("[v0] 🔍 Campos disponibles en PowerSchool guardian:", Object.keys(partnerGuardians[0]))
    console.log("[v0] 🔍 Sample PowerSchool guardian:", JSON.stringify(partnerGuardians[0]).substring(0, 300))
  }
  if (cometaGuardians.length > 0) {
    console.log("[v0] 🔍 Campos disponibles en Cometa guardian:", Object.keys(cometaGuardians[0]))
    console.log("[v0] 🔍 Sample Cometa guardian:", JSON.stringify(cometaGuardians[0]).substring(0, 300))
  }

  for (const partnerGuardian of partnerGuardians) {
    let matched = false
    let matchedCometaGuardian: any = null
    let matchReason: string | null = null

    const partnerFirstName = partnerGuardian.firstName || partnerGuardian.first_name || ""
    const partnerLastName = partnerGuardian.lastName || partnerGuardian.last_name || ""
    const partnerEmail = partnerGuardian.emails || partnerGuardian.email || ""
    const partnerPhone = partnerGuardian.phones || partnerGuardian.phone || ""

    console.log(`[v0] Matching guardian: ${partnerFirstName} ${partnerLastName}`)
    console.log(`[v0] Guardian email: ${partnerEmail}, phone: ${partnerPhone}`)

    for (const rule of sortedRules) {
      if (matched) break

      if (rule.id === "phone") {
        const normalizedPartnerPhone = normalizePhone(partnerPhone)
        console.log(`[v0] Checking phone: "${normalizedPartnerPhone}"`)

        if (normalizedPartnerPhone) {
          const cometaMatch = cometaGuardians.find((cg) => {
            const cometaPhone = normalizePhone(cg.phone || cg.phone_number || "")
            return cometaPhone === normalizedPartnerPhone && !matchedCometaIds.has(cg.id || cg.guardian_id)
          })
          if (cometaMatch) {
            matched = true
            matchedCometaGuardian = cometaMatch
            matchReason = "Teléfono"
            matchedCometaIds.add(cometaMatch.id || cometaMatch.guardian_id)
            console.log(`[v0] Match found by phone: ${normalizedPartnerPhone}`)
          }
        }
      } else if (rule.id === "email") {
        const normalizedPartnerEmail = normalizeString(partnerEmail)
        console.log(`[v0] Checking email: "${normalizedPartnerEmail}"`)

        if (normalizedPartnerEmail) {
          const cometaMatch = cometaGuardians.find((cg) => {
            const cometaEmail = normalizeString(cg.email || "")
            return cometaEmail === normalizedPartnerEmail && !matchedCometaIds.has(cg.id || cg.guardian_id)
          })
          if (cometaMatch) {
            matched = true
            matchedCometaGuardian = cometaMatch
            matchReason = "Email"
            matchedCometaIds.add(cometaMatch.id || cometaMatch.guardian_id)
            console.log(`[v0] Match found by email: ${normalizedPartnerEmail}`)
          }
        }
      } else if (rule.id === "name") {
        const partnerFullName = normalizeFullName(partnerFirstName, partnerLastName)
        console.log(`[v0] Checking name: "${partnerFullName}"`)

        if (partnerFullName) {
          const cometaMatch = cometaGuardians.find((cg) => {
            const cometaFirstName = cg.first_name || cg.nombre || ""
            const cometaLastName = cg.last_name || cg.apellido || ""
            const cometaFullName = normalizeFullName(cometaFirstName, cometaLastName)
            return cometaFullName === partnerFullName && !matchedCometaIds.has(cg.id || cg.guardian_id)
          })
          if (cometaMatch) {
            matched = true
            matchedCometaGuardian = cometaMatch
            matchReason = "Nombre Completo"
            matchedCometaIds.add(cometaMatch.id || cometaMatch.guardian_id)
            console.log(`[v0] Match found by name: ${partnerFullName}`)
          }
        }
      }
    }

    // Verificar si el tutor está asignado a estudiantes comparables en ambos sistemas
    let studentMismatch = false
    if (matched && matchedCometaGuardian) {
      // Obtener todos los estudiantes del tutor en ambos sistemas
      const partnerStudents = partnerGuardian.students || []
      const cometaStudents = matchedCometaGuardian.students || []

      // Extraer apellidos (últimas 2 palabras - apellido paterno y materno)
      const extractLastNames = (fullName: string) => {
        const parts = fullName.split(" ").filter(p => p.length > 0)
        if (parts.length >= 2) {
          return parts.slice(-2).join(" ")
        }
        return ""
      }

      // Extraer todos los apellidos de los estudiantes de cada sistema
      const partnerLastNamesList = partnerStudents.map((s: any) => 
        normalizeString(extractLastNames(s.student_name || ""))
      ).filter(Boolean)
      
      const cometaLastNamesList = cometaStudents.map((s: any) => 
        normalizeString(extractLastNames(s.student_name || ""))
      ).filter(Boolean)

      console.log(`[v0] 👨‍👩‍👧‍👦 Tutor ${partnerGuardian.firstName || partnerGuardian.first_name || ""}:`)
      console.log(`[v0]   - PowerSchool: ${partnerStudents.length} estudiante(s) - Apellidos: [${partnerLastNamesList.join(", ")}]`)
      console.log(`[v0]   - Cometa: ${cometaStudents.length} estudiante(s) - Apellidos: [${cometaLastNamesList.join(", ")}]`)

      // Verificar si hay al menos un apellido en común
      const hasCommonLastNames = partnerLastNamesList.some(partnerLN => 
        cometaLastNamesList.some(cometaLN => partnerLN === cometaLN)
      )

      if (!hasCommonLastNames && partnerLastNamesList.length > 0 && cometaLastNamesList.length > 0) {
        // No hay apellidos en común = estudiantes completamente diferentes
        studentMismatch = true
        console.log(`[v0] ⚠️ ADVERTENCIA: Tutor emparejado pero sin apellidos en común entre estudiantes!`)
        console.log(`[v0]   - PowerSchool apellidos: ${partnerLastNamesList.join(", ")}`)
        console.log(`[v0]   - Cometa apellidos: ${cometaLastNamesList.join(", ")}`)
      } else if (hasCommonLastNames) {
        console.log(`[v0] ✅ Apellidos coinciden - mismo tutor para la misma familia`)
      }
    }

    results.push({
      partnerData: partnerGuardian,
      cometaData: matchedCometaGuardian,
      matchStatus: matched ? "matched" : "only_partner",
      matchReason,
      confidence: matched ? (studentMismatch ? 0.5 : 1.0) : 0.0,
      studentMismatch, // Agregar flag para indicar discrepancia de estudiante
    })
  }

  for (const cometaGuardian of cometaGuardians) {
    const cometaId = cometaGuardian.id || cometaGuardian.guardian_id
    if (!matchedCometaIds.has(cometaId)) {
      results.push({
        partnerData: null,
        cometaData: cometaGuardian,
        matchStatus: "only_cometa",
        matchReason: null,
        confidence: 0.0,
        studentMismatch: false,
      })
    }
  }

  console.log("[v0] Guardian matching complete. Total results:", results.length)
  console.log("[v0] Matched:", results.filter((r) => r.matchStatus === "matched").length)
  console.log("[v0] Only partner:", results.filter((r) => r.matchStatus === "only_partner").length)
  console.log("[v0] Only cometa:", results.filter((r) => r.matchStatus === "only_cometa").length)
  
  const mismatchCount = results.filter((r) => (r as any).studentMismatch === true).length
  if (mismatchCount > 0) {
    console.log(`[v0] ⚠️ ADVERTENCIA: ${mismatchCount} tutores emparejados pero asignados a diferentes estudiantes`)
  }

  return results
}

function normalizeMatricula(value: any): string {
  if (value === null || value === undefined) return ""
  const str = String(value)
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quitar acentos
    .toLowerCase()
    .replace(/[-\s]+/g, "") // Quitar guiones y espacios
    .trim()
}

function normalizeString(value: any): string {
  if (value === null || value === undefined) return ""
  const str = String(value)
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeFullName(firstName: any, lastName: any): string {
  const first = String(firstName || "")
  const last = String(lastName || "")

  // Normalizar sin acentos y colapsar espacios
  const normalizedFirst = first
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()

  const normalizedLast = last
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()

  // Aplicar Title-Case
  const titleCase = (str: string) => {
    return str
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  }

  return `${titleCase(normalizedFirst)} ${titleCase(normalizedLast)}`.trim()
}

function normalizeDate(value: any): string {
  if (!value) return ""
  const dateStr = String(value)
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ""

    // Usar UTC para evitar problemas de zona horaria
    const year = d.getUTCFullYear()
    const month = String(d.getUTCMonth() + 1).padStart(2, "0")
    const day = String(d.getUTCDate()).padStart(2, "0")

    return `${year}-${month}-${day}`
  } catch {
    return ""
  }
}

function normalizePhone(value: any): string {
  if (!value) return ""
  const str = String(value)
  // Limpiar: solo dígitos
  const digitsOnly = str.replace(/\D/g, "")
  
  // Quitar prefijos internacionales comunes (+52, +1, etc.)
  let cleaned = digitsOnly
  if (cleaned.startsWith("52") && cleaned.length > 10) {
    cleaned = cleaned.substring(2) // Quitar +52
  }
  if (cleaned.startsWith("1") && cleaned.length === 11) {
    cleaned = cleaned.substring(1) // Quitar +1 (USA/Canada)
  }
  
  // Devolver solo los últimos 10 dígitos (número local) para matching consistente
  return cleaned.slice(-10)
}

export async function getGuardiansForSingleSchoolBatch(
  tenantIntegrationId: string,
  schoolId: string,
  partner: string,
  startIndex: number,
  batchSize: number,
  existingGuardiansMap: Record<string, any> = {},
): Promise<{
  success: boolean
  guardians?: any[]
  error?: string
  totalStudents?: number
  processedCount?: number
  isComplete?: boolean
}> {
  try {
    console.log(`[v0] 🔄 BATCH: Procesando lote ${Math.floor(startIndex / batchSize) + 1} desde índice ${startIndex}`)
    
    // Obtener estudiantes de la escuela
    const studentsResult = await getStudents(tenantIntegrationId, schoolId)
    if (!studentsResult.success || !studentsResult.students) {
      console.error(`[v0] ❌ BATCH: Error obteniendo estudiantes`)
      return {
        success: false,
        error: `Error obteniendo estudiantes de escuela ${schoolId}`,
      }
    }

    const students = studentsResult.students
    const totalStudents = students.length

    if (startIndex === 0) {
      console.log(`[v0] 📊 BATCH: Total de ${students.length} estudiantes, procesando en lotes de ${batchSize}`)
    }

    const guardiansMap = new Map<string, any>(Object.entries(existingGuardiansMap))
    const DELAY_BETWEEN_REQUESTS_MS = 150 // Reducido para actualizaciones más rápidas

    const endIndex = Math.min(startIndex + batchSize, totalStudents)
    const studentsToProcess = students.slice(startIndex, endIndex)
    
    console.log(`[v0] 📦 BATCH: Procesando estudiantes ${startIndex + 1} a ${endIndex} de ${totalStudents}`)

    // Obtener tutores de cada estudiante en este lote
    for (let i = 0; i < studentsToProcess.length; i++) {
      const student = studentsToProcess[i]
      const studentId = student.id || student.student_id
      const globalIndex = startIndex + i

      if (i > 0) {
        await delay(DELAY_BETWEEN_REQUESTS_MS)
      }

      const guardiansResult = await getGuardians(tenantIntegrationId, studentId, schoolId, partner)

      if (guardiansResult.success && guardiansResult.guardians) {
        for (const guardian of guardiansResult.guardians) {
          const guardianId = guardian.id || guardian.guardian_id || guardian.email || guardian.phone
          const studentInfo = {
            student_id: studentId,
            student_name: `${student.first_name || ""} ${student.last_name || ""}`.trim() || "-",
            student_local_id: student.local_id || student.student_number || "-",
          }
          
          if (guardianId) {
            if (!guardiansMap.has(guardianId)) {
              guardiansMap.set(guardianId, {
                ...guardian,
                students: [studentInfo], // Array de estudiantes
                school_id: schoolId,
              })
            } else {
              // Agregar este estudiante a la lista del tutor
              const existingGuardian = guardiansMap.get(guardianId)
              if (!existingGuardian.students.some((s: any) => s.student_id === studentId)) {
                existingGuardian.students.push(studentInfo)
              }
            }
          }
        }
      }
    }

    const isComplete = endIndex >= totalStudents
    const guardiansList = Array.from(guardiansMap.values())
    
    console.log(
      `[v0] ✅ BATCH: Completado lote - ${endIndex}/${totalStudents} estudiantes (${guardiansList.length} tutores únicos acumulados)`,
    )

    // ⚠️ NO REDUCIR datos de PowerSchool - necesitamos preservar todos los campos para matching
    return {
      success: true,
      guardians: guardiansList,
      totalStudents,
      processedCount: endIndex,
      isComplete,
    }
  } catch (error) {
    console.error(`[v0] ❌ BATCH: Error en lote:`, error)
    return {
      success: false,
      error: `Error inesperado en escuela ${schoolId}`,
    }
  }
}

// Obtener tutores de un estudiante específico de Cometa (Schools API)
export async function getStudentGuardiansFromCometa(
  studentId: string,
): Promise<{ success: boolean; guardians?: any[]; error?: string }> {
  try {
    if (!SCHOOLS_API_TOKEN) {
      return {
        success: false,
        error: "SCHOOLS_API_TOKEN no está configurado",
      }
    }

    const guardiansUrl = `${SCHOOLS_API_BASE_URL}/api/v1/students/${studentId}/guardians`
    console.log(`[v0] Obteniendo tutores de Cometa para estudiante ${studentId}`)

    const response = await fetch(guardiansUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${SCHOOLS_API_TOKEN}`,
        "User-Agent": "v0-integration-app",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Error HTTP ${response.status}: ${errorText.substring(0, 100)}`,
      }
    }

    const responseText = await response.text()
    let guardiansData: any

    try {
      guardiansData = JSON.parse(responseText)
    } catch {
      return {
        success: false,
        error: "Error parseando respuesta JSON",
      }
    }

    // La respuesta puede ser un array directamente o un objeto con data
    let guardians: any[] = []
    if (Array.isArray(guardiansData)) {
      guardians = guardiansData
    } else if (guardiansData.data && Array.isArray(guardiansData.data)) {
      guardians = guardiansData.data
    }

    return {
      success: true,
      guardians,
    }
  } catch (error) {
    console.error(`[v0] Error obteniendo tutores de Cometa para estudiante:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

// Comparar tutores de estudiantes emparejados entre PowerSchool y Cometa
export interface GuardianComparisonResult {
  studentId: string
  studentName: string
  studentLocalId: string
  cometaStudentId: string | null
  powerschoolGuardians: any[]
  cometaGuardians: any[]
  discrepancies: {
    onlyInPowerschool: any[]
    onlyInCometa: any[]
    matched: any[]
    dataDifferences: {
      guardianName: string
      field: string
      powerschoolValue: string
      cometaValue: string
    }[]
  }
  hasDiscrepancies: boolean
}

// Obtener lista de estudiantes emparejados para procesar
export async function getMatchedStudentsListFromSession(
  sessionId: string
): Promise<{ 
  success: boolean; 
  students?: { index: number; studentId: string; studentName: string; cometaStudentId: string | null; schoolId: string }[]; 
  error?: string 
}> {
  try {
    const matchedStudents = getMatchedStudentsForComparison(sessionId)
    
    if (matchedStudents.length === 0) {
      return {
        success: false,
        error: "No hay estudiantes emparejados en esta sesión",
      }
    }

    // Limpiar resultados anteriores
    clearGuardianComparisonResults(sessionId)

    // Devolver lista simplificada de estudiantes para procesar
    const students = matchedStudents.map((s, index) => ({
      index,
      studentId: s.partnerData?.id || s.partnerData?.student_id || "",
      studentName: `${s.partnerData?.first_name || ""} ${s.partnerData?.last_name || ""}`.trim(),
      studentLocalId: s.partnerData?.local_id || s.partnerData?.student_number || "-",
      cometaStudentId: s.cometaData?.id || s.cometaData?.student_id || null,
      schoolId: s.partnerData?.school_id || "",
    })).filter(s => s.studentId && s.schoolId)

    return {
      success: true,
      students,
    }
  } catch (error) {
    console.error("[v0] Error en getMatchedStudentsListFromSession:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

// Procesar UN estudiante individual y guardar resultado
export async function processOneStudentGuardians(
  tenantIntegrationId: string,
  sessionId: string,
  studentId: string,
  studentName: string,
  studentLocalId: string,
  cometaStudentId: string | null,
  schoolId: string,
): Promise<{ success: boolean; hasDiscrepancies?: boolean; error?: string }> {
  try {
    console.log(`[v0] Procesando tutores para: ${studentName}`)

    // 1. Obtener tutores de PowerSchool
    let powerschoolGuardians: any[] = []
    const psResult = await getGuardians(tenantIntegrationId, studentId, schoolId, "powerschool")
    if (psResult.success && psResult.guardians) {
      powerschoolGuardians = psResult.guardians
    }

    // 2. Obtener tutores de Cometa
    let cometaGuardians: any[] = []
    if (cometaStudentId) {
      const cmResult = await getStudentGuardiansFromCometa(cometaStudentId)
      if (cmResult.success && cmResult.guardians) {
        cometaGuardians = cmResult.guardians
      }
    }

    // 3. Comparar tutores
    const comparison = compareGuardianLists(powerschoolGuardians, cometaGuardians)

    const hasDiscrepancies =
      comparison.onlyInPowerschool.length > 0 ||
      comparison.onlyInCometa.length > 0 ||
      comparison.dataDifferences.length > 0

    // 4. Guardar resultado en SQLite
    saveGuardianComparisonResult(sessionId, {
      studentId,
      studentName,
      studentLocalId,
      cometaStudentId,
      powerschoolGuardians,
      cometaGuardians,
      discrepancies: comparison,
      hasDiscrepancies,
    })

    return {
      success: true,
      hasDiscrepancies,
    }
  } catch (error) {
    console.error(`[v0] Error procesando estudiante ${studentName}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

// Función legacy para comparar tutores usando sessionId (lee de SQLite) - mantener por compatibilidad
export async function compareStudentGuardiansFromSession(
  tenantIntegrationId: string,
  sessionId: string,
): Promise<{ success: boolean; totalStudents?: number; error?: string }> {
  try {
    // Leer estudiantes emparejados desde SQLite
    const matchedStudents = getMatchedStudentsForComparison(sessionId)
    
    if (matchedStudents.length === 0) {
      return {
        success: false,
        error: "No hay estudiantes emparejados en esta sesión",
      }
    }

    console.log(`[v0] Comparando tutores de ${matchedStudents.length} estudiantes emparejados (desde SQLite)`)

    // Limpiar resultados anteriores de comparación para esta sesión
    clearGuardianComparisonResults(sessionId)

    const DELAY_BETWEEN_REQUESTS_MS = 200

    for (let i = 0; i < matchedStudents.length; i++) {
      const matchedStudent = matchedStudents[i]
      const partnerStudent = matchedStudent.partnerData
      const cometaStudent = matchedStudent.cometaData

      if (!partnerStudent || !cometaStudent) continue

      const studentName = `${partnerStudent.first_name || ""} ${partnerStudent.last_name || ""}`.trim()
      const studentLocalId = partnerStudent.local_id || partnerStudent.student_number || "-"
      const partnerStudentId = partnerStudent.id || partnerStudent.student_id
      const cometaStudentId = cometaStudent?.id || cometaStudent?.student_id || null
      const schoolId = partnerStudent.school_id

      console.log(`[v0] [${i + 1}/${matchedStudents.length}] Procesando: ${studentName}`)

      // 1. Obtener tutores de PowerSchool
      let powerschoolGuardians: any[] = []
      if (partnerStudentId && schoolId) {
        const psResult = await getGuardians(tenantIntegrationId, partnerStudentId, schoolId, "powerschool")
        if (psResult.success && psResult.guardians) {
          powerschoolGuardians = psResult.guardians
        }
      }

      // Pequeño delay para evitar rate limiting
      await delay(DELAY_BETWEEN_REQUESTS_MS)

      // 2. Obtener tutores de Cometa
      let cometaGuardians: any[] = []
      if (cometaStudentId) {
        const cmResult = await getStudentGuardiansFromCometa(cometaStudentId)
        if (cmResult.success && cmResult.guardians) {
          cometaGuardians = cmResult.guardians
        }
      }

      // 3. Comparar tutores
      const comparison = compareGuardianLists(powerschoolGuardians, cometaGuardians)

      // 4. Guardar resultado en SQLite
      saveGuardianComparisonResult(sessionId, {
        studentId: partnerStudentId,
        studentName,
        studentLocalId,
        cometaStudentId,
        powerschoolGuardians,
        cometaGuardians,
        discrepancies: comparison,
        hasDiscrepancies:
          comparison.onlyInPowerschool.length > 0 ||
          comparison.onlyInCometa.length > 0 ||
          comparison.dataDifferences.length > 0,
      })

      // Delay entre estudiantes
      if (i < matchedStudents.length - 1) {
        await delay(DELAY_BETWEEN_REQUESTS_MS)
      }
    }

    console.log(`[v0] Comparación completada y guardada en SQLite`)

    return {
      success: true,
      totalStudents: matchedStudents.length,
    }
  } catch (error) {
    console.error("[v0] Error en compareStudentGuardiansFromSession:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

// Obtener resultados de comparación de tutores desde SQLite
export async function getGuardianComparisonResultsFromDB(
  sessionId: string
): Promise<{ success: boolean; results?: GuardianComparisonResult[]; error?: string }> {
  try {
    const results = getGuardianComparisonResults(sessionId)
    return {
      success: true,
      results,
    }
  } catch (error) {
    console.error("[v0] Error obteniendo resultados de comparación:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

// Obtener progreso de la comparación (cuántos se han procesado)
export async function getComparisonProgress(
  sessionId: string
): Promise<{ success: boolean; processed?: number; total?: number }> {
  try {
    const results = getGuardianComparisonResults(sessionId)
    const matchedStudents = getMatchedStudentsForComparison(sessionId)
    
    return {
      success: true,
      processed: results.length,
      total: matchedStudents.length,
    }
  } catch (error) {
    return {
      success: false,
    }
  }
}

// Verificar si hay resultados de comparación existentes para una sesión
export async function checkExistingComparisonResults(
  sessionId: string
): Promise<{ 
  success: boolean; 
  hasResults: boolean; 
  count?: number;
  withDiscrepancies?: number;
}> {
  try {
    const results = getGuardianComparisonResults(sessionId)
    const withDiscrepancies = results.filter(r => r.hasDiscrepancies).length
    
    return {
      success: true,
      hasResults: results.length > 0,
      count: results.length,
      withDiscrepancies,
    }
  } catch (error) {
    return {
      success: false,
      hasResults: false,
    }
  }
}

// Buscar la sesión más reciente que tenga resultados de comparación de tutores
export async function findLatestComparisonResults(
  tenantIntegrationId: string
): Promise<{ 
  success: boolean; 
  hasResults: boolean; 
  sessionId?: string;
  count?: number;
  withDiscrepancies?: number;
}> {
  try {
    const result = getLatestSessionWithComparisonResults(tenantIntegrationId)
    
    if (result.sessionId) {
      return {
        success: true,
        hasResults: true,
        sessionId: result.sessionId,
        count: result.count,
        withDiscrepancies: result.withDiscrepancies,
      }
    }
    
    return {
      success: true,
      hasResults: false,
    }
  } catch (error) {
    console.error("[v0] Error buscando resultados de comparación:", error)
    return {
      success: false,
      hasResults: false,
    }
  }
}

export async function compareStudentGuardians(
  tenantIntegrationId: string,
  matchedStudents: MatchedStudent[],
  onProgress?: (current: number, total: number, studentName: string) => void,
): Promise<{ success: boolean; results?: GuardianComparisonResult[]; error?: string }> {
  try {
    const results: GuardianComparisonResult[] = []
    const DELAY_BETWEEN_REQUESTS_MS = 200

    // Solo procesar estudiantes que están emparejados (tienen datos en ambos sistemas)
    const studentsToProcess = matchedStudents.filter(
      (s) => s.matchStatus === "matched" && s.partnerData && s.cometaData
    )

    console.log(`[v0] Comparando tutores de ${studentsToProcess.length} estudiantes emparejados`)

    for (let i = 0; i < studentsToProcess.length; i++) {
      const matchedStudent = studentsToProcess[i]
      const partnerStudent = matchedStudent.partnerData
      const cometaStudent = matchedStudent.cometaData

      const studentName = `${partnerStudent.first_name || ""} ${partnerStudent.last_name || ""}`.trim()
      const studentLocalId = partnerStudent.local_id || partnerStudent.student_number || "-"
      const partnerStudentId = partnerStudent.id || partnerStudent.student_id
      const cometaStudentId = cometaStudent?.id || cometaStudent?.student_id || null
      const schoolId = partnerStudent.school_id

      if (onProgress) {
        onProgress(i + 1, studentsToProcess.length, studentName)
      }

      console.log(`[v0] [${i + 1}/${studentsToProcess.length}] Procesando: ${studentName}`)

      // 1. Obtener tutores de PowerSchool
      let powerschoolGuardians: any[] = []
      if (partnerStudentId && schoolId) {
        const psResult = await getGuardians(tenantIntegrationId, partnerStudentId, schoolId, "powerschool")
        if (psResult.success && psResult.guardians) {
          powerschoolGuardians = psResult.guardians
        }
      }

      // Pequeño delay para evitar rate limiting
      await delay(DELAY_BETWEEN_REQUESTS_MS)

      // 2. Obtener tutores de Cometa
      let cometaGuardians: any[] = []
      if (cometaStudentId) {
        const cmResult = await getStudentGuardiansFromCometa(cometaStudentId)
        if (cmResult.success && cmResult.guardians) {
          cometaGuardians = cmResult.guardians
        }
      }

      // 3. Comparar tutores
      const comparison = compareGuardianLists(powerschoolGuardians, cometaGuardians)

      results.push({
        studentId: partnerStudentId,
        studentName,
        studentLocalId,
        cometaStudentId,
        powerschoolGuardians,
        cometaGuardians,
        discrepancies: comparison,
        hasDiscrepancies:
          comparison.onlyInPowerschool.length > 0 ||
          comparison.onlyInCometa.length > 0 ||
          comparison.dataDifferences.length > 0,
      })

      // Delay entre estudiantes
      if (i < studentsToProcess.length - 1) {
        await delay(DELAY_BETWEEN_REQUESTS_MS)
      }
    }

    console.log(`[v0] Comparación completada. ${results.filter((r) => r.hasDiscrepancies).length} estudiantes con discrepancias`)

    return {
      success: true,
      results,
    }
  } catch (error) {
    console.error("[v0] Error en compareStudentGuardians:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

// Función para calcular similitud entre dos strings (Levenshtein simplificado)
function stringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0
  if (str1 === str2) return 1
  
  const s1 = str1.toLowerCase()
  const s2 = str2.toLowerCase()
  
  if (s1 === s2) return 1
  
  // Si uno contiene al otro, alta similitud
  if (s1.includes(s2) || s2.includes(s1)) return 0.9
  
  // Calcular distancia de edición simple
  const longer = s1.length > s2.length ? s1 : s2
  const shorter = s1.length > s2.length ? s2 : s1
  
  if (longer.length === 0) return 1
  
  // Contar caracteres en común
  let matches = 0
  const shorterChars = shorter.split('')
  const longerChars = longer.split('')
  
  shorterChars.forEach(char => {
    const idx = longerChars.indexOf(char)
    if (idx !== -1) {
      matches++
      longerChars.splice(idx, 1)
    }
  })
  
  return matches / longer.length
}

// Normalizar email para comparación fuzzy
function normalizeEmailForFuzzy(email: string): string {
  if (!email) return ""
  const normalized = email.toLowerCase().trim()
  // Quitar puntos antes del @ (gmail los ignora, otros también pueden variar)
  const [local, domain] = normalized.split("@")
  if (!local || !domain) return normalized
  // Quitar puntos y guiones bajos del local part
  const cleanLocal = local.replace(/[._-]/g, "")
  return `${cleanLocal}@${domain}`
}

// Verificar si dos emails son "fuzzy igual"
function emailsFuzzyEqual(email1: string, email2: string): boolean {
  if (!email1 || !email2) return false
  
  const norm1 = normalizeEmailForFuzzy(email1)
  const norm2 = normalizeEmailForFuzzy(email2)
  
  // Comparación exacta después de normalizar
  if (norm1 === norm2) return true
  
  // Comparar dominios - deben ser iguales
  const [local1, domain1] = norm1.split("@")
  const [local2, domain2] = norm2.split("@")
  
  if (domain1 !== domain2) return false
  
  // Si los locales son muy similares (>85%), considerar iguales
  const similarity = stringSimilarity(local1, local2)
  return similarity > 0.85
}

// Verificar si dos nombres son "fuzzy igual"
function namesFuzzyEqual(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false
  
  const normalize = (n: string) => n
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  
  const n1 = normalize(name1)
  const n2 = normalize(name2)
  
  if (n1 === n2) return true
  
  // Comparar por palabras (nombres pueden estar en diferente orden)
  const words1 = n1.split(" ").filter(w => w.length >= 2)
  const words2 = n2.split(" ").filter(w => w.length >= 2)
  
  // Si ordenados son iguales
  if (words1.sort().join(" ") === words2.sort().join(" ")) return true
  
  // Si tienen al menos 2 palabras en común de 3+ caracteres
  const commonWords = words1.filter(w => w.length >= 3 && words2.some(w2 => w === w2 || stringSimilarity(w, w2) > 0.8))
  if (commonWords.length >= 2) return true
  
  // NUEVO: Detectar apellidos en común (útil para nombres abreviados como "Bucio Cuen Asist")
  // Si comparten al menos 1 apellido Y la similitud es > 50%, considerar match
  const commonApellidos = words1.filter(w => w.length >= 4 && words2.includes(w))
  if (commonApellidos.length >= 1 && stringSimilarity(n1, n2) > 0.5) return true
  
  // NUEVO: Si uno es substring del otro (nombre abreviado)
  if (n1.length > 5 && n2.length > 5) {
    if (n1.includes(n2) || n2.includes(n1)) return true
  }
  
  // NUEVO: Comparar iniciales + apellidos
  // "Luis Armando Bucio Mendez" vs "L A Bucio Mendez" o "Bucio Mendez Luis"
  const getApellidos = (words: string[]) => words.filter(w => w.length >= 4)
  const apellidos1 = getApellidos(words1)
  const apellidos2 = getApellidos(words2)
  const commonApellidosStrict = apellidos1.filter(a => apellidos2.includes(a))
  if (commonApellidosStrict.length >= 2) return true
  
  // Similitud general
  return stringSimilarity(n1, n2) > 0.75
}

function compareGuardianLists(
  psGuardians: any[],
  cmGuardians: any[],
): {
  onlyInPowerschool: any[]
  onlyInCometa: any[]
  matched: any[]
  dataDifferences: { guardianName: string; field: string; powerschoolValue: string; cometaValue: string }[]
} {
  const onlyInPowerschool: any[] = []
  const onlyInCometa: any[] = []
  const matched: any[] = []
  const dataDifferences: { guardianName: string; field: string; powerschoolValue: string; cometaValue: string }[] = []

  const matchedCometaIds = new Set<string>()

  // Normalizar para comparación exacta
  const normalizeForMatch = (value: string) => {
    return (value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  }

  const normalizePhoneForMatch = (phone: string) => {
    return (phone || "").replace(/\D/g, "").slice(-10)
  }

  // Para cada tutor de PowerSchool, buscar match en Cometa
  for (const psGuardian of psGuardians) {
    const psFirstName = normalizeForMatch(psGuardian.firstName || psGuardian.first_name || "")
    const psLastName = normalizeForMatch(psGuardian.lastName || psGuardian.last_name || "")
    const psFullName = `${psFirstName} ${psLastName}`.trim()
    const psEmailRaw = psGuardian.emails || psGuardian.email || ""
    const psEmail = normalizeForMatch(psEmailRaw)
    const psPhoneRaw = psGuardian.phones || psGuardian.phone || ""
    const psPhone = normalizePhoneForMatch(psPhoneRaw)

    let foundMatch = false
    let matchedCmGuardian: any = null

    for (const cmGuardian of cmGuardians) {
      const cmId = cmGuardian.id || cmGuardian.guardian_id
      if (matchedCometaIds.has(cmId)) continue

      const cmFirstName = normalizeForMatch(cmGuardian.first_name || cmGuardian.nombre || "")
      const cmLastName = normalizeForMatch(cmGuardian.last_name || cmGuardian.apellido || "")
      const cmFullName = `${cmFirstName} ${cmLastName}`.trim()
      const cmEmailRaw = cmGuardian.email || ""
      const cmEmail = normalizeForMatch(cmEmailRaw)
      const cmPhoneRaw = cmGuardian.phone || cmGuardian.phone_number || ""
      const cmPhone = normalizePhoneForMatch(cmPhoneRaw)

      // Intentar match por teléfono, email (fuzzy) o nombre (fuzzy)
      const phoneMatch = psPhone && cmPhone && psPhone === cmPhone
      const emailMatch = emailsFuzzyEqual(psEmailRaw, cmEmailRaw)
      const nameMatch = namesFuzzyEqual(psFullName, cmFullName)

      if (phoneMatch || emailMatch || nameMatch) {
        foundMatch = true
        matchedCmGuardian = cmGuardian
        matchedCometaIds.add(cmId)

        // Verificar diferencias SIGNIFICATIVAS en datos
        const psDisplayName = `${psGuardian.firstName || psGuardian.first_name || ""} ${psGuardian.lastName || psGuardian.last_name || ""}`.trim()
        const cmDisplayName = `${cmGuardian.first_name || cmGuardian.nombre || ""} ${cmGuardian.last_name || cmGuardian.apellido || ""}`.trim()

        // Solo reportar diferencia de nombre si NO son fuzzy iguales
        if (!namesFuzzyEqual(psDisplayName, cmDisplayName) && psDisplayName && cmDisplayName) {
          dataDifferences.push({
            guardianName: psDisplayName || cmDisplayName,
            field: "Nombre",
            powerschoolValue: psDisplayName,
            cometaValue: cmDisplayName,
          })
        }

        // Solo reportar diferencia de email si NO son fuzzy iguales
        const psDisplayEmail = psGuardian.emails || psGuardian.email || ""
        const cmDisplayEmail = cmGuardian.email || ""
        if (!emailsFuzzyEqual(psDisplayEmail, cmDisplayEmail) && psDisplayEmail && cmDisplayEmail) {
          dataDifferences.push({
            guardianName: psDisplayName || cmDisplayName,
            field: "Email",
            powerschoolValue: psDisplayEmail,
            cometaValue: cmDisplayEmail,
          })
        }

        // Solo reportar diferencia de teléfono si son realmente diferentes
        const psDisplayPhone = psGuardian.phones || psGuardian.phone || ""
        const cmDisplayPhone = cmGuardian.phone || cmGuardian.phone_number || ""
        if (psPhone !== cmPhone && psDisplayPhone && cmDisplayPhone) {
          dataDifferences.push({
            guardianName: psDisplayName || cmDisplayName,
            field: "Teléfono",
            powerschoolValue: psDisplayPhone,
            cometaValue: cmDisplayPhone,
          })
        }

        break
      }
    }

    if (foundMatch && matchedCmGuardian) {
      matched.push({ powerschool: psGuardian, cometa: matchedCmGuardian })
    } else {
      onlyInPowerschool.push(psGuardian)
    }
  }

  // Tutores de Cometa que no tienen match en PowerSchool
  for (const cmGuardian of cmGuardians) {
    const cmId = cmGuardian.id || cmGuardian.guardian_id
    if (!matchedCometaIds.has(cmId)) {
      onlyInCometa.push(cmGuardian)
    }
  }

  return {
    onlyInPowerschool,
    onlyInCometa,
    matched,
    dataDifferences,
  }
}

export async function getGuardiansForSingleSchool(
  tenantIntegrationId: string,
  schoolId: string,
  partner: string,
): Promise<{ success: boolean; guardians?: any[]; error?: string; studentCount?: number }> {
  try {
    console.log(`[v0] Obteniendo tutores para escuela ${schoolId}`)

    const guardiansMap = new Map<string, any>()
    const DELAY_BETWEEN_REQUESTS_MS = 250

    // Obtener estudiantes de la escuela
    const studentsResult = await getStudents(tenantIntegrationId, schoolId)
    if (!studentsResult.success || !studentsResult.students) {
      return {
        success: false,
        error: `Error obteniendo estudiantes de escuela ${schoolId}`,
      }
    }

    const students = studentsResult.students
    console.log(`[v0] Procesando ${students.length} estudiantes de escuela ${schoolId}`)

    // Obtener tutores de cada estudiante
    for (let studentIndex = 0; studentIndex < students.length; studentIndex++) {
      const student = students[studentIndex]
      const studentId = student.id || student.student_id

      // Log de progreso cada 10 estudiantes
      if (studentIndex % 10 === 0 || studentIndex === students.length - 1) {
        console.log(`[v0] Progreso escuela ${schoolId}: ${studentIndex + 1}/${students.length} estudiantes procesados`)
      }

      if (studentIndex > 0) {
        await delay(DELAY_BETWEEN_REQUESTS_MS)
      }

      const guardiansResult = await getGuardians(tenantIntegrationId, studentId, schoolId, partner)

      if (guardiansResult.success && guardiansResult.guardians) {
        for (const guardian of guardiansResult.guardians) {
          const guardianId = guardian.id || guardian.guardian_id || guardian.email || guardian.phone
          const studentInfo = {
            student_id: studentId,
            student_name: `${student.first_name || ""} ${student.last_name || ""}`.trim() || "-",
            student_local_id: student.local_id || student.student_number || "-",
          }
          
          if (guardianId) {
            if (!guardiansMap.has(guardianId)) {
              guardiansMap.set(guardianId, {
                ...guardian,
                students: [studentInfo], // Array de estudiantes
                school_id: schoolId,
              })
            } else {
              // Agregar este estudiante a la lista del tutor
              const existingGuardian = guardiansMap.get(guardianId)
              if (!existingGuardian.students.some((s: any) => s.student_id === studentId)) {
                existingGuardian.students.push(studentInfo)
              }
            }
          }
        }
      }
    }

    const guardians = Array.from(guardiansMap.values())
    console.log(`[v0] Escuela ${schoolId}: ${guardians.length} tutores únicos obtenidos`)

    return {
      success: true,
      guardians,
      studentCount: students.length,
    }
  } catch (error) {
    console.error(`[v0] Error obteniendo tutores para escuela ${schoolId}:`, error)
    return {
      success: false,
      error: `Error inesperado en escuela ${schoolId}`,
    }
  }
}
