// In-memory storage for match sessions and results
// This replaces better-sqlite3 since SQLite doesn't work on Vercel serverless

interface MatchSession {
  id: string
  tenant_integration_id: string
  tenant_id: string | null
  data_type: string
  created_at: string
  total_results: number
}

interface MatchResult {
  id: number
  session_id: string
  partner_data: string | null
  cometa_data: string | null
  match_status: string
  match_reason: string | null
  confidence: number
  created_at: string
}

interface GuardianComparisonResult {
  id: number
  session_id: string
  student_id: string
  student_name: string
  student_local_id: string
  cometa_student_id: string | null
  powerschool_guardians: string
  cometa_guardians: string
  discrepancies: string
  has_discrepancies: number
  created_at: string
}

const matchSessions = new Map<string, MatchSession>()
const matchResults = new Map<string, MatchResult[]>()
const guardianComparisonResults = new Map<string, GuardianComparisonResult[]>()
let autoIncrementMatchResult = 1
let autoIncrementGuardianResult = 1

export function createMatchSession(
  tenantIntegrationId: string,
  tenantId: string | null,
  dataType: string
): string {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`

  matchSessions.set(sessionId, {
    id: sessionId,
    tenant_integration_id: tenantIntegrationId,
    tenant_id: tenantId,
    data_type: dataType,
    created_at: new Date().toISOString(),
    total_results: 0,
  })

  matchResults.set(sessionId, [])
  guardianComparisonResults.set(sessionId, [])

  return sessionId
}

export function saveMatchResults(sessionId: string, results: any[]): void {
  const sessionResults: MatchResult[] = []

  for (const result of results) {
    sessionResults.push({
      id: autoIncrementMatchResult++,
      session_id: sessionId,
      partner_data: result.partnerData ? JSON.stringify(result.partnerData) : null,
      cometa_data: result.cometaData ? JSON.stringify(result.cometaData) : null,
      match_status: result.matchStatus,
      match_reason: result.matchReason,
      confidence: result.confidence,
      created_at: new Date().toISOString(),
    })
  }

  matchResults.set(sessionId, sessionResults)

  const session = matchSessions.get(sessionId)
  if (session) {
    session.total_results = results.length
  }
}

export function getMatchResults(sessionId: string): any[] {
  const rows = matchResults.get(sessionId) || []

  return rows.map((row) => ({
    partnerData: row.partner_data ? JSON.parse(row.partner_data) : null,
    cometaData: row.cometa_data ? JSON.parse(row.cometa_data) : null,
    matchStatus: row.match_status,
    matchReason: row.match_reason,
    confidence: row.confidence,
  }))
}

export function getMatchedStudentsForComparison(sessionId: string): any[] {
  const rows = matchResults.get(sessionId) || []

  return rows
    .filter((row) => row.match_status === "matched")
    .map((row) => ({
      partnerData: row.partner_data ? JSON.parse(row.partner_data) : null,
      cometaData: row.cometa_data ? JSON.parse(row.cometa_data) : null,
      matchStatus: "matched",
    }))
}

export function saveGuardianComparisonResult(
  sessionId: string,
  result: {
    studentId: string
    studentName: string
    studentLocalId: string
    cometaStudentId: string | null
    powerschoolGuardians: any[]
    cometaGuardians: any[]
    discrepancies: any
    hasDiscrepancies: boolean
  }
): void {
  const existing = guardianComparisonResults.get(sessionId) || []

  existing.push({
    id: autoIncrementGuardianResult++,
    session_id: sessionId,
    student_id: result.studentId,
    student_name: result.studentName,
    student_local_id: result.studentLocalId,
    cometa_student_id: result.cometaStudentId,
    powerschool_guardians: JSON.stringify(result.powerschoolGuardians),
    cometa_guardians: JSON.stringify(result.cometaGuardians),
    discrepancies: JSON.stringify(result.discrepancies),
    has_discrepancies: result.hasDiscrepancies ? 1 : 0,
    created_at: new Date().toISOString(),
  })

  guardianComparisonResults.set(sessionId, existing)
}

export function getGuardianComparisonResults(sessionId: string): any[] {
  const rows = guardianComparisonResults.get(sessionId) || []

  return rows.map((row) => ({
    studentId: row.student_id,
    studentName: row.student_name,
    studentLocalId: row.student_local_id,
    cometaStudentId: row.cometa_student_id,
    powerschoolGuardians: JSON.parse(row.powerschool_guardians || "[]"),
    cometaGuardians: JSON.parse(row.cometa_guardians || "[]"),
    discrepancies: JSON.parse(row.discrepancies || "{}"),
    hasDiscrepancies: row.has_discrepancies === 1,
  }))
}

export function clearGuardianComparisonResults(sessionId: string): void {
  guardianComparisonResults.set(sessionId, [])
}

export function getSessionInfo(sessionId: string): any | null {
  return matchSessions.get(sessionId) || null
}

export function cleanupOldSessions(): void {
  const now = new Date()
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  for (const [sessionId, session] of matchSessions.entries()) {
    if (new Date(session.created_at) < cutoff) {
      matchSessions.delete(sessionId)
      matchResults.delete(sessionId)
      guardianComparisonResults.delete(sessionId)
    }
  }
}

export function getLatestSessionWithComparisonResults(tenantIntegrationId: string): {
  sessionId: string | null
  count: number
  withDiscrepancies: number
} {
  let latestSession: MatchSession | null = null

  for (const session of matchSessions.values()) {
    if (
      session.tenant_integration_id === tenantIntegrationId &&
      session.data_type === "students"
    ) {
      const results = guardianComparisonResults.get(session.id) || []
      if (results.length > 0) {
        if (!latestSession || session.created_at > latestSession.created_at) {
          latestSession = session
        }
      }
    }
  }

  if (latestSession) {
    const results = guardianComparisonResults.get(latestSession.id) || []
    const withDiscrepancies = results.filter((r) => r.has_discrepancies === 1).length

    return {
      sessionId: latestSession.id,
      count: results.length,
      withDiscrepancies,
    }
  }

  return {
    sessionId: null,
    count: 0,
    withDiscrepancies: 0,
  }
}
