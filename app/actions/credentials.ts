"use server"

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

    return {
      success: true,
      students: studentsData.data,
    }
  } catch (error) {
    console.error("[v0] Error in getStudents:", error)
    return {
      success: false,
      error: "Ocurrió un error inesperado al obtener estudiantes",
    }
  }
}

export async function getCometaStudents(tenantIntegrationId: string, tenantId: string) {
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

    console.log("[v0] Estudiantes de Cometa obtenidos exitosamente:", cometaData.data.length)
    return {
      success: true,
      students: cometaData.data,
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
): Promise<{ success: boolean; results?: MatchedStudent[]; error?: string }> {
  try {
    console.log("[v0] Iniciando matching en el servidor...")
    console.log("[v0] Total estudiantes de PowerSchool recibidos:", partnerStudents.length)

    const cometaResult = await getCometaStudents(tenantIntegrationId, tenantId)
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

    return {
      success: true,
      results,
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
            if (guardianId && !guardiansMap.has(guardianId)) {
              guardiansMap.set(guardianId, {
                ...guardian,
                student_id: studentId,
                school_id: schoolId,
              })
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
    const cometaStudentsResult = await getCometaStudents(tenantIntegrationId, tenantId)

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

    const allGuardians: any[] = []
    const guardiansMap = new Map<string, any>()
    let successfulRequests = 0
    let failedRequests = 0

    // Obtener tutores para cada estudiante usando el endpoint de Schools API
    console.log("[v0] Paso 2: Obteniendo tutores de cada estudiante...")

    for (let i = 0; i < students.length; i++) {
      const student = students[i]
      const studentId = student.id || student.student_id

      if (!studentId) {
        console.warn(`[v0] ⚠️ Estudiante ${i + 1} sin ID, saltando:`, student)
        continue
      }

      const guardiansUrl = `${SCHOOLS_API_BASE_URL}/api/v1/students/${studentId}/guardians`

      const progress = `${i + 1}/${students.length}`
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
            if (guardianId && !guardiansMap.has(guardianId)) {
              guardiansMap.set(guardianId, {
                ...guardian,
                student_id: studentId,
              })
              newGuardiansCount++
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
      if (i < students.length - 1) {
        await delay(200)
      }
    }

    allGuardians.push(...Array.from(guardiansMap.values()))

    console.log("[v0] ========== FIN: Resumen de obtención de tutores ==========")
    console.log("[v0] Estudiantes procesados:", students.length)
    console.log("[v0] Requests exitosos:", successfulRequests)
    console.log("[v0] Requests fallidos:", failedRequests)
    console.log("[v0] Total tutores únicos:", allGuardians.length)
    console.log("[v0] ============================================================")

    return {
      success: true,
      guardians: allGuardians,
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
  rules: MatchRule[],
): Promise<{ success: boolean; results?: MatchedStudent[]; error?: string }> {
  try {
    console.log("[v0] Iniciando matching de tutores en el servidor...")
    console.log("[v0] tenantIntegrationId:", tenantIntegrationId)
    console.log("[v0] tenantId:", tenantId)
    console.log("[v0] schoolIds:", schoolIds)
    console.log("[v0] Total tutores de PowerSchool recibidos:", partnerGuardians.length)
    console.log("[v0] Sample partner guardian:", partnerGuardians[0])

    const cometaResult = await getCometaGuardians(tenantIntegrationId, tenantId, schoolIds)
    if (!cometaResult.success || !cometaResult.guardians) {
      console.error("[v0] Error al obtener tutores de Cometa:", cometaResult.error)
      return {
        success: false,
        error: cometaResult.error || "Error al obtener tutores de Cometa",
      }
    }

    console.log("[v0] Total tutores de Cometa:", cometaResult.guardians.length)
    console.log("[v0] Sample cometa guardian:", cometaResult.guardians[0])

    const results = await matchGuardians(partnerGuardians, cometaResult.guardians, rules)

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

    results.push({
      partnerData: partnerGuardian,
      cometaData: matchedCometaGuardian,
      matchStatus: matched ? "matched" : "only_partner",
      matchReason,
      confidence: matched ? 1.0 : 0.0,
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
      })
    }
  }

  console.log("[v0] Guardian matching complete. Total results:", results.length)
  console.log("[v0] Matched:", results.filter((r) => r.matchStatus === "matched").length)
  console.log("[v0] Only partner:", results.filter((r) => r.matchStatus === "only_partner").length)
  console.log("[v0] Only cometa:", results.filter((r) => r.matchStatus === "only_cometa").length)

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
  const cleaned = str.replace(/[^\d+]/g, "")
  if (!cleaned.startsWith("+")) {
    return `+52${cleaned}`
  }
  return cleaned
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

      if (studentIndex > 0) {
        await delay(DELAY_BETWEEN_REQUESTS_MS)
      }

      const guardiansResult = await getGuardians(tenantIntegrationId, studentId, schoolId, partner)

      if (guardiansResult.success && guardiansResult.guardians) {
        for (const guardian of guardiansResult.guardians) {
          const guardianId = guardian.id || guardian.guardian_id || guardian.email || guardian.phone
          if (guardianId && !guardiansMap.has(guardianId)) {
            guardiansMap.set(guardianId, {
              ...guardian,
              student_id: studentId,
              school_id: schoolId,
            })
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
