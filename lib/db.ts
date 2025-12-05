import Database from "better-sqlite3"
import path from "path"

// Crear la base de datos en el directorio del proyecto
const dbPath = path.join(process.cwd(), "data", "integration.db")

// Asegurarse de que el directorio existe
import fs from "fs"
const dataDir = path.join(process.cwd(), "data")
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const db = new Database(dbPath)

// Habilitar WAL mode para mejor rendimiento
db.pragma("journal_mode = WAL")

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS match_sessions (
    id TEXT PRIMARY KEY,
    tenant_integration_id TEXT NOT NULL,
    tenant_id TEXT,
    data_type TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    total_results INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS match_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    partner_data TEXT,
    cometa_data TEXT,
    match_status TEXT NOT NULL,
    match_reason TEXT,
    confidence REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES match_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS guardian_comparison_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    student_name TEXT,
    student_local_id TEXT,
    cometa_student_id TEXT,
    powerschool_guardians TEXT,
    cometa_guardians TEXT,
    discrepancies TEXT,
    has_discrepancies INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES match_sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_match_results_session ON match_results(session_id);
  CREATE INDEX IF NOT EXISTS idx_guardian_comparison_session ON guardian_comparison_results(session_id);
`)

export { db }

// Funciones de utilidad para match sessions
export function createMatchSession(
  tenantIntegrationId: string,
  tenantId: string | null,
  dataType: string
): string {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`
  
  const stmt = db.prepare(`
    INSERT INTO match_sessions (id, tenant_integration_id, tenant_id, data_type)
    VALUES (?, ?, ?, ?)
  `)
  
  stmt.run(sessionId, tenantIntegrationId, tenantId, dataType)
  
  return sessionId
}

export function saveMatchResults(sessionId: string, results: any[]): void {
  const insertStmt = db.prepare(`
    INSERT INTO match_results (session_id, partner_data, cometa_data, match_status, match_reason, confidence)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const updateSessionStmt = db.prepare(`
    UPDATE match_sessions SET total_results = ? WHERE id = ?
  `)

  const insertMany = db.transaction((results: any[]) => {
    for (const result of results) {
      insertStmt.run(
        sessionId,
        result.partnerData ? JSON.stringify(result.partnerData) : null,
        result.cometaData ? JSON.stringify(result.cometaData) : null,
        result.matchStatus,
        result.matchReason,
        result.confidence
      )
    }
    updateSessionStmt.run(results.length, sessionId)
  })

  insertMany(results)
}

export function getMatchResults(sessionId: string): any[] {
  const stmt = db.prepare(`
    SELECT * FROM match_results WHERE session_id = ?
  `)
  
  const rows = stmt.all(sessionId) as any[]
  
  return rows.map(row => ({
    partnerData: row.partner_data ? JSON.parse(row.partner_data) : null,
    cometaData: row.cometa_data ? JSON.parse(row.cometa_data) : null,
    matchStatus: row.match_status,
    matchReason: row.match_reason,
    confidence: row.confidence,
  }))
}

export function getMatchedStudentsForComparison(sessionId: string): any[] {
  const stmt = db.prepare(`
    SELECT partner_data, cometa_data FROM match_results 
    WHERE session_id = ? AND match_status = 'matched'
  `)
  
  const rows = stmt.all(sessionId) as any[]
  
  return rows.map(row => ({
    partnerData: row.partner_data ? JSON.parse(row.partner_data) : null,
    cometaData: row.cometa_data ? JSON.parse(row.cometa_data) : null,
    matchStatus: 'matched',
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
  const stmt = db.prepare(`
    INSERT INTO guardian_comparison_results 
    (session_id, student_id, student_name, student_local_id, cometa_student_id, 
     powerschool_guardians, cometa_guardians, discrepancies, has_discrepancies)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  stmt.run(
    sessionId,
    result.studentId,
    result.studentName,
    result.studentLocalId,
    result.cometaStudentId,
    JSON.stringify(result.powerschoolGuardians),
    JSON.stringify(result.cometaGuardians),
    JSON.stringify(result.discrepancies),
    result.hasDiscrepancies ? 1 : 0
  )
}

export function getGuardianComparisonResults(sessionId: string): any[] {
  const stmt = db.prepare(`
    SELECT * FROM guardian_comparison_results WHERE session_id = ?
  `)
  
  const rows = stmt.all(sessionId) as any[]
  
  return rows.map(row => ({
    studentId: row.student_id,
    studentName: row.student_name,
    studentLocalId: row.student_local_id,
    cometaStudentId: row.cometa_student_id,
    powerschoolGuardians: JSON.parse(row.powerschool_guardians || '[]'),
    cometaGuardians: JSON.parse(row.cometa_guardians || '[]'),
    discrepancies: JSON.parse(row.discrepancies || '{}'),
    hasDiscrepancies: row.has_discrepancies === 1,
  }))
}

export function clearGuardianComparisonResults(sessionId: string): void {
  const stmt = db.prepare(`DELETE FROM guardian_comparison_results WHERE session_id = ?`)
  stmt.run(sessionId)
}

export function getSessionInfo(sessionId: string): any | null {
  const stmt = db.prepare(`SELECT * FROM match_sessions WHERE id = ?`)
  return stmt.get(sessionId) as any | null
}

// Limpiar sesiones antiguas (más de 24 horas)
export function cleanupOldSessions(): void {
  const stmt = db.prepare(`
    DELETE FROM match_sessions 
    WHERE datetime(created_at) < datetime('now', '-24 hours')
  `)
  stmt.run()
}

// Obtener la sesión más reciente que tenga resultados de comparación de tutores
export function getLatestSessionWithComparisonResults(tenantIntegrationId: string): {
  sessionId: string | null
  count: number
  withDiscrepancies: number
} {
  // Buscar sesiones con resultados de comparación
  const stmt = db.prepare(`
    SELECT 
      ms.id as session_id,
      COUNT(gcr.id) as result_count,
      SUM(CASE WHEN gcr.has_discrepancies = 1 THEN 1 ELSE 0 END) as discrepancy_count
    FROM match_sessions ms
    INNER JOIN guardian_comparison_results gcr ON gcr.session_id = ms.id
    WHERE ms.tenant_integration_id = ? AND ms.data_type = 'students'
    GROUP BY ms.id
    ORDER BY ms.created_at DESC
    LIMIT 1
  `)
  
  const row = stmt.get(tenantIntegrationId) as any
  
  if (row && row.result_count > 0) {
    return {
      sessionId: row.session_id,
      count: row.result_count,
      withDiscrepancies: row.discrepancy_count || 0,
    }
  }
  
  return {
    sessionId: null,
    count: 0,
    withDiscrepancies: 0,
  }
}

