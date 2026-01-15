"use client"

import { useState, useMemo, useEffect } from "react"
import * as XLSX from "xlsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, XCircle, AlertTriangle, Download } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { MatchedStudent } from "@/app/actions/credentials"
import { createReference, checkReferenceExists, processOneReference } from "@/app/actions/credentials"
import { Spinner } from "@/components/ui/spinner"
import { Link, LinkIcon } from "lucide-react"
import { Progress } from "@/components/ui/progress"

interface MatchResultsTableProps {
  results: MatchedStudent[]
  dataType?: "students" | "guardians"
  tenantIntegrationId?: string
}

const ITEMS_PER_PAGE = 10

const STATUS_CONFIG = {
  matched: {
    label: "Emparejado",
    icon: CheckCircle2,
    color: "bg-success-50 text-success-700 border-success-200",
    iconColor: "text-success-500",
  },
  only_partner: {
    label: "Solo Partner",
    icon: AlertCircle,
    color: "bg-warning-50 text-warning-700 border-warning-200",
    iconColor: "text-warning-500",
  },
  only_cometa: {
    label: "Solo Cometa",
    icon: AlertCircle,
    color: "bg-aurora-50 text-aurora-700 border-aurora-200",
    iconColor: "text-aurora-500",
  },
  conflict_duplicate: {
    label: "Conflicto",
    icon: XCircle,
    color: "bg-error-50 text-error-700 border-error-200",
    iconColor: "text-error-500",
  },
}

const formatSection = (section: any): string => {
  if (!section) return "-"
  if (typeof section === "string") {
    try {
      section = JSON.parse(section)
    } catch {
      return section
    }
  }
  if (typeof section === "object" && section !== null) {
    const grade = section.grade || ""
    const group = section.group || ""
    if (grade && group) {
      return `${grade}° ${group}`
    }
    if (grade) return `${grade}°`
    if (group) return group
  }
  return "-"
}

const getRelevantCometaFields = (data: any) => {
  if (!data) return {}

  const section = formatSection(data.section)
  const birthdate = data.birthdate ? normalizeDateForComparison(data.birthdate) : "-"

  return {
    "ID Cometa": data.id || data.student_id || "-",
    Nombre: data.first_name && data.last_name ? `${data.first_name} ${data.middle_name || ""} ${data.last_name}`.replace(/\s+/g, " ").trim() : "-",
    Matrícula: data.enrollment_code || "-",
    CURP: data.identifier || "-",
    "Fecha de Nacimiento": birthdate,
    Género: data.gender || "-",
    "Grado y Grupo": section,
    Estado: data.state || "-",
    Eliminado: data.deleted_at ? `Sí (${data.deleted_at})` : "No",
  }
}

const getRelevantPartnerFields = (data: any, cometaData?: any) => {
  if (!data) return {}

  // Buscar el grado en múltiples campos posibles (nueva estructura usa grade_name)
  const grade = data.grade_level || data.grade || data.grade_name || data.gradelevel || data.current_grade || "-"
  const level = data.level || data.level_name || "-"
  const dob = data.dob || data.birthdate || data.fecha_nacimiento
  const birthdate = dob ? normalizeDateForComparison(dob) : "-"
  
  // Construir nombre desde la nueva estructura (nombre_estudiante, apellido_estudiante)
  // o desde la estructura antigua (first_name, last_name)
  const firstName = data.first_name || data.nombre_estudiante || ""
  const middleName = data.middle_name || data.segundo_nombre_estudiante || ""
  const lastName = data.last_name || data.apellido_estudiante || ""
  const fullName = firstName && lastName 
    ? `${firstName} ${middleName} ${lastName}`.replace(/\s+/g, " ").trim() 
    : "-"

  // CURP: Si PowerSchool no tiene CURP pero Cometa sí (y están emparejados), mostrar el de Cometa con indicador
  const partnerCurp = data.curp || data.state_studentnumber || ""
  const cometaCurp = cometaData?.identifier || ""
  let curpDisplay = "-"
  if (partnerCurp) {
    curpDisplay = partnerCurp
  } else if (cometaCurp) {
    curpDisplay = `${cometaCurp} (de Cometa)`
  }

  return {
    "ID PowerSchool": data.id || data.student_id || data.id_estudiante || "-",
    Nombre: fullName,
    "Matrícula (Local ID)": data.local_id || data.student_number || "-",
    "Student Number": data.student_number || data.local_id || "-",
    CURP: curpDisplay,
    "Fecha de Nacimiento": birthdate,
    Género: data.gender || data.genero || "-",
    Grado: grade,
    Nivel: level !== "-" ? level : undefined,
  }
}

const getRelevantPartnerGuardianFields = (data: any) => {
  if (!data) return {}

  // Construir nombre desde múltiples posibles estructuras
  // Nueva estructura: nombre_contacto, apellido_contacto
  // Estructura antigua: firstName, lastName o first_name, last_name
  const firstName = data.firstName || data.first_name || data.nombre_contacto || ""
  const middleName = data.middleName || data.middle_name || data.segundo_nombre_contacto || ""
  const lastName = data.lastName || data.last_name || data.apellido_contacto || ""
  const fullName = firstName && lastName
    ? `${firstName} ${middleName} ${lastName}`.replace(/\s+/g, " ").trim()
    : "-"

  return {
    Nombre: fullName,
    Email: data.emails || data.email || data.email_contacto || "-",
    Teléfono: data.phones || data.phone || data.telefono_contacto || "-",
    Relación: data.relationship || data.relacion || "-",
    "ID Guardian": data.id || data.guardian_id || data.id_contacto || "-",
    "Estudiantes Asociados": Array.isArray(data.students) 
      ? data.students.map((s: any) => s.student_name || s.student_id).join(", ") 
      : data.student_id || "-",
  }
}

const getRelevantCometaGuardianFields = (data: any) => {
  if (!data) return {}

  return {
    Nombre: data.first_name && data.last_name ? `${data.first_name} ${data.middle_name || ""} ${data.last_name}`.replace(/\s+/g, " ").trim() : "-",
    Email: data.email || "-",
    Teléfono: data.phone || data.phone_number || "-",
    "ID Guardian": data.id || data.guardian_id || "-",
    "ID Estudiante Asociado (Cometa)": data.student_id || "-",
  }
}

const normalizeDateForComparison = (dateStr: string): string => {
  if (!dateStr) return ""
  try {
    // Intentar parsear la fecha y convertirla a formato YYYY-MM-DD usando UTC
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return ""

    // Usar métodos UTC para evitar problemas de zona horaria
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")

    return `${year}-${month}-${day}`
  } catch {
    return ""
  }
}

// Función auxiliar para comparación fuzzy de nombres
const namesFuzzyEqualForDiscrepancy = (name1: string, name2: string): boolean => {
  if (!name1 || !name2) return false
  const n1 = name1.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim()
  const n2 = name2.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim()
  if (n1 === n2) return true
  // Si uno contiene al otro (para manejar apellido materno faltante)
  if (n1.length > 5 && n2.length > 5 && (n1.includes(n2) || n2.includes(n1))) return true
  // Si comparten al menos 2 palabras de 3+ caracteres
  const words1 = n1.split(" ").filter(w => w.length >= 3)
  const words2 = n2.split(" ").filter(w => w.length >= 3)
  const commonWords = words1.filter(w => words2.includes(w))
  return commonWords.length >= 2
}

const compareStudentData = (partnerData: any, cometaData: any) => {
  if (!partnerData || !cometaData) return {}

  const discrepancies: Record<string, { partner: string; cometa: string }> = {}

  // Comparar nombres (incluyendo middle_name)
  const partnerName = `${partnerData.first_name || ""} ${partnerData.middle_name || ""} ${partnerData.last_name || ""}`.replace(/\s+/g, " ").trim()
  const cometaName = `${cometaData.first_name || ""} ${cometaData.middle_name || ""} ${cometaData.last_name || ""}`.replace(/\s+/g, " ").trim()
  
  // Solo marcar como discrepancia si NO son fuzzy iguales
  if (partnerName && cometaName && !namesFuzzyEqualForDiscrepancy(partnerName, cometaName)) {
    discrepancies.Nombre = {
      partner: partnerName,
      cometa: cometaName,
    }
  }

  // Comparar CURP
  const partnerCURP = (partnerData.curp || partnerData.state_studentnumber || "").toLowerCase()
  const cometaCURP = (cometaData.identifier || "").toLowerCase()
  if (partnerCURP && cometaCURP && partnerCURP !== cometaCURP) {
    discrepancies.CURP = {
      partner: partnerData.curp || partnerData.state_studentnumber || "-",
      cometa: cometaData.identifier || "-",
    }
  }

  const partnerDOB = partnerData.dob || partnerData.birthdate || ""
  const cometaDOB = cometaData.birthdate || ""
  const normalizedPartnerDOB = normalizeDateForComparison(partnerDOB)
  const normalizedCometaDOB = normalizeDateForComparison(cometaDOB)

  if (normalizedPartnerDOB && normalizedCometaDOB && normalizedPartnerDOB !== normalizedCometaDOB) {
    discrepancies["Fecha de Nacimiento"] = {
      partner: partnerDOB,
      cometa: cometaDOB,
    }
  }

  // Comparar género
  const partnerGender = (partnerData.gender || "").toUpperCase()
  const cometaGender = (cometaData.gender || "").toUpperCase()
  if (partnerGender && cometaGender && partnerGender !== cometaGender) {
    discrepancies.Género = {
      partner: partnerData.gender || "-",
      cometa: cometaData.gender || "-",
    }
  }

  // Comparar grado - normalizar quitando símbolos como "°" para que "10°" == "10"
  const normalizeGrade = (grade: string): string => {
    return grade
      .replace(/°/g, "") // Quitar símbolo de grado
      .replace(/º/g, "") // Quitar símbolo ordinal
      .replace(/\s+/g, "") // Quitar espacios
      .trim()
      .toLowerCase()
  }
  
  const partnerGradeRaw = String(
    partnerData.grade_level || partnerData.grade || partnerData.gradelevel || partnerData.current_grade || "",
  )
  const cometaSection = cometaData.section
  let cometaGradeRaw = ""
  if (cometaSection) {
    if (typeof cometaSection === "string") {
      try {
        const parsed = JSON.parse(cometaSection)
        cometaGradeRaw = String(parsed.grade || "")
      } catch {
        // Ignore parse errors
      }
    } else if (typeof cometaSection === "object") {
      cometaGradeRaw = String(cometaSection.grade || "")
    }
  }
  
  // Comparar versiones normalizadas (sin símbolos)
  const partnerGradeNorm = normalizeGrade(partnerGradeRaw)
  const cometaGradeNorm = normalizeGrade(cometaGradeRaw)
  
  if (partnerGradeRaw && cometaGradeRaw && partnerGradeNorm !== cometaGradeNorm) {
    discrepancies.Grado = {
      partner: partnerGradeRaw,
      cometa: cometaGradeRaw,
    }
  }

  return discrepancies
}

const compareGuardianData = (partnerData: any, cometaData: any) => {
  if (!partnerData || !cometaData) return {}

  const discrepancies: Record<string, { partner: string; cometa: string }> = {}

  // Comparar nombres (incluyendo middle_name si existe)
  const partnerName = `${partnerData.firstName || partnerData.first_name || ""} ${partnerData.middleName || partnerData.middle_name || ""} ${partnerData.lastName || partnerData.last_name || ""}`.replace(/\s+/g, " ").trim()
  const cometaName = `${cometaData.first_name || cometaData.nombre || ""} ${cometaData.middle_name || ""} ${cometaData.last_name || cometaData.apellido || ""}`.replace(/\s+/g, " ").trim()

  // Solo marcar como discrepancia si NO son fuzzy iguales
  if (partnerName && cometaName && !namesFuzzyEqualForDiscrepancy(partnerName, cometaName)) {
    discrepancies.Nombre = {
      partner: partnerName,
      cometa: cometaName,
    }
  }

  // Comparar email
  const partnerEmail = (partnerData.emails || partnerData.email || "").toLowerCase().trim()
  const cometaEmail = (cometaData.email || "").toLowerCase().trim()
  if (partnerEmail && cometaEmail && partnerEmail !== cometaEmail) {
    discrepancies.Email = {
      partner: partnerData.emails || partnerData.email || "-",
      cometa: cometaData.email || "-",
    }
  }

  // Comparar teléfono (normalizado)
  const normalizePhoneForComparison = (phone: string) => {
    return phone.replace(/\D/g, "").slice(-10) // Solo últimos 10 dígitos
  }
  
  const formatPhoneWithCountryCode = (phone: string) => {
    if (!phone || phone === "-") return "-"
    const digitsOnly = phone.replace(/\D/g, "")
    const last10 = digitsOnly.slice(-10)
    return last10 ? `+52${last10}` : phone
  }
  
  const partnerPhoneRaw = partnerData.phones || partnerData.phone || ""
  const cometaPhoneRaw = cometaData.phone || cometaData.phone_number || ""
  const partnerPhone = normalizePhoneForComparison(partnerPhoneRaw)
  const cometaPhone = normalizePhoneForComparison(cometaPhoneRaw)
  
  if (partnerPhone && cometaPhone && partnerPhone !== cometaPhone) {
    // Solo agregar discrepancia si los números realmente difieren después de normalizar
    discrepancies.Teléfono = {
      partner: formatPhoneWithCountryCode(partnerPhoneRaw),
      cometa: formatPhoneWithCountryCode(cometaPhoneRaw),
    }
  }

  // ⚠️ NUEVO: Comparar estudiante asignado
  const partnerStudentId = partnerData.student_id
  const cometaStudentId = cometaData.student_id
  if (partnerStudentId && cometaStudentId && partnerStudentId !== cometaStudentId) {
    discrepancies["Estudiante Asignado"] = {
      partner: partnerStudentId,
      cometa: cometaStudentId,
    }
  }

  return discrepancies
}

const compareStudentGuardians = (partnerData: any, cometaData: any) => {
  if (!partnerData || !cometaData) return { hasDiscrepancy: false, details: null }

  // Obtener los IDs de estudiantes para buscar tutores
  const partnerStudentId = partnerData.id || partnerData.student_id || partnerData.local_id
  const cometaStudentId = cometaData.id || cometaData.student_id

  // Los datos de tutores deberían venir en los campos guardians o contacts
  const partnerGuardians = partnerData.guardians || partnerData.contacts || []
  const cometaGuardians = cometaData.guardians || cometaData.guardians_data || []

  // Normalizar a arrays
  const partnerGuardiansArray = Array.isArray(partnerGuardians) ? partnerGuardians : []
  const cometaGuardiansArray = Array.isArray(cometaGuardians) ? cometaGuardians : []

  const partnerCount = partnerGuardiansArray.length
  const cometaCount = cometaGuardiansArray.length

  // Extraer nombres de tutores para comparación
  const getGuardianName = (g: any) => {
    const firstName = g.firstName || g.first_name || g.nombre || ""
    const lastName = g.lastName || g.last_name || g.apellido || ""
    return `${firstName} ${lastName}`.trim()
  }

  const partnerNames = partnerGuardiansArray.map(getGuardianName).filter(Boolean)
  const cometaNames = cometaGuardiansArray.map(getGuardianName).filter(Boolean)

  // Verificar si hay discrepancia
  const hasDiscrepancy = partnerCount !== cometaCount || 
    !partnerNames.every(name => cometaNames.some(cn => cn.toLowerCase() === name.toLowerCase()))

  if (hasDiscrepancy || partnerCount > 0 || cometaCount > 0) {
    return {
      hasDiscrepancy,
      details: {
        partnerCount,
        cometaCount,
        partnerNames: partnerNames.length > 0 ? partnerNames.join(", ") : "Sin tutores",
        cometaNames: cometaNames.length > 0 ? cometaNames.join(", ") : "Sin tutores",
        partnerGuardians: partnerGuardiansArray,
        cometaGuardians: cometaGuardiansArray,
      }
    }
  }

  return { hasDiscrepancy: false, details: null }
}

const getGuardianStudentDiscrepancy = (partnerData: any, cometaData: any): { 
  hasDiscrepancy: boolean; 
  reason: string | null;
  psCount: number;
  cmCount: number;
  syncIssue: "none" | "missing_in_cometa" | "extra_in_cometa" | "different";
} => {
  if (!partnerData || !cometaData) return { hasDiscrepancy: false, reason: null, psCount: 0, cmCount: 0, syncIssue: "none" }

  const partnerStudents = partnerData.students || 
    (partnerData.student_id ? [{
      student_id: partnerData.student_id,
      student_name: partnerData.student_name
    }] : [])
  
  const cometaStudents = cometaData.students || 
    (cometaData.student_id ? [{
      student_id: cometaData.student_id,
      student_name: cometaData.student_name
    }] : [])

  const psCount = partnerStudents.length
  const cmCount = cometaStudents.length

  if (psCount === 0 && cmCount === 0) return { hasDiscrepancy: false, reason: null, psCount, cmCount, syncIssue: "none" }
  
  // Normalizamos nombres para comparación
  const normalizeName = (name: string) => {
    return (name || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  }

  const partnerNames = partnerStudents.map((s: any) => normalizeName(s.student_name)).sort()
  const cometaNames = cometaStudents.map((s: any) => normalizeName(s.student_name)).sort()

  // Determinar tipo de problema de sincronización
  let syncIssue: "none" | "missing_in_cometa" | "extra_in_cometa" | "different" = "none"
  
  // 1. Verificar cantidad
  if (psCount !== cmCount) {
    if (psCount > cmCount) {
      syncIssue = "missing_in_cometa" // Faltan estudiantes en Cometa (deben sincronizarse)
    } else {
      syncIssue = "extra_in_cometa" // Hay estudiantes de más en Cometa
    }
    return { 
      hasDiscrepancy: true, 
      reason: `Cantidad diferente: PowerSchool (${psCount}) vs Cometa (${cmCount})`,
      psCount,
      cmCount,
      syncIssue
    }
  }

  // Función para comparación fuzzy de nombres de estudiantes
  const studentNamesFuzzyMatch = (name1: string, name2: string): boolean => {
    if (name1 === name2) return true
    // Si uno contiene al otro
    if (name1.length > 5 && name2.length > 5 && (name1.includes(name2) || name2.includes(name1))) return true
    // Si comparten al menos 2 palabras de 3+ caracteres
    const words1 = name1.split(" ").filter(w => w.length >= 3)
    const words2 = name2.split(" ").filter(w => w.length >= 3)
    const commonWords = words1.filter(w => words2.includes(w))
    return commonWords.length >= 2
  }

  // 2. Verificar si cada estudiante de PS tiene match fuzzy en Cometa
  const unmatchedPS: string[] = []
  const unmatchedCometa: string[] = [...cometaNames]
  
  for (const psName of partnerNames) {
    const matchIndex = unmatchedCometa.findIndex(cmName => studentNamesFuzzyMatch(psName, cmName))
    if (matchIndex >= 0) {
      unmatchedCometa.splice(matchIndex, 1) // Remover el match encontrado
    } else {
      unmatchedPS.push(psName)
    }
  }
  
  // Si hay estudiantes sin match en cualquiera de los lados
  if (unmatchedPS.length > 0 || unmatchedCometa.length > 0) {
     let details = []
     if (unmatchedPS.length > 0) details.push(`Solo en PS: ${unmatchedPS.slice(0, 2).join(", ")}${unmatchedPS.length > 2 ? "..." : ""}`)
     if (unmatchedCometa.length > 0) details.push(`Solo en Cometa: ${unmatchedCometa.slice(0, 2).join(", ")}${unmatchedCometa.length > 2 ? "..." : ""}`)
     
     syncIssue = "different"
     
     return {
       hasDiscrepancy: true,
       reason: `Estudiantes diferentes. ${details.join(". ")}`,
       psCount,
       cmCount,
       syncIssue
     }
  }

  return { hasDiscrepancy: false, reason: null, psCount, cmCount, syncIssue: "none" }
}

// Helper para extraer el grupo del estudiante de Cometa
const getStudentGroup = (cometaData: any): string | null => {
  if (!cometaData?.section) return null
  let section = cometaData.section
  if (typeof section === "string") {
    try {
      section = JSON.parse(section)
    } catch {
      return null
    }
  }
  if (typeof section === "object" && section !== null) {
    const group = section.group
    // Verificar que el grupo exista y no sea vacío
    if (group && typeof group === "string" && group.trim() !== "") {
      return group.trim()
    }
    return null
  }
  return null
}

export function MatchResultsTable({ results, dataType = "students", tenantIntegrationId }: MatchResultsTableProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedStudent, setSelectedStudent] = useState<MatchedStudent | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // Filtro para excluir grupo W o sin grupo
  const [excludeGroupW, setExcludeGroupW] = useState(true)
  
  // Estado para crear referencias
  const [isCreatingReference, setIsCreatingReference] = useState(false)
  const [referenceResult, setReferenceResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  
  // Estado para verificar si existe referencia
  const [isCheckingReference, setIsCheckingReference] = useState(false)
  const [referenceStatus, setReferenceStatus] = useState<{
    exists: boolean
    reference?: any
    checked: boolean
  } | null>(null)
  
  // Estado para crear referencias en lote
  const [isBulkCreating, setIsBulkCreating] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ 
    current: 0, 
    total: 0, 
    currentName: "",
    lastAction: "" as "" | "created" | "exists" | "error",
    lastMessage: ""
  })
  const [bulkResult, setBulkResult] = useState<{
    created: number
    skipped: number
    failed: number
    errors: string[]
    details: Array<{
      name: string
      status: "created" | "exists" | "error"
      message: string
    }>
  } | null>(null)

  const resultsWithDiscrepancies = useMemo(() => {
    return results.map((result) => {
      const discrepancies = dataType === "guardians" 
        ? compareGuardianData(result.partnerData, result.cometaData)
        : compareStudentData(result.partnerData, result.cometaData)
      
      // Para estudiantes, también verificar discrepancias en tutores asignados
      const guardianComparison = dataType === "students"
        ? compareStudentGuardians(result.partnerData, result.cometaData)
        : { hasDiscrepancy: false, details: null }

      // Para tutores, verificar discrepancias en estudiantes asignados
      const guardianStudentDiscrepancy = dataType === "guardians"
        ? getGuardianStudentDiscrepancy(result.partnerData, result.cometaData)
        : { hasDiscrepancy: false, reason: null, psCount: 0, cmCount: 0, syncIssue: "none" as const }

      const fieldDiscrepanciesCount = Object.keys(discrepancies).length
      const totalDiscrepanciesCount = fieldDiscrepanciesCount + (guardianComparison.hasDiscrepancy ? 1 : 0) + (guardianStudentDiscrepancy.hasDiscrepancy ? 1 : 0)

      return {
        ...result,
        hasDiscrepancies: totalDiscrepanciesCount > 0,
        discrepanciesCount: totalDiscrepanciesCount,
        hasGuardianDiscrepancy: guardianComparison.hasDiscrepancy,
        studentMismatch: guardianStudentDiscrepancy.hasDiscrepancy,
        studentMismatchReason: guardianStudentDiscrepancy.reason,
        psStudentCount: guardianStudentDiscrepancy.psCount,
        cmStudentCount: guardianStudentDiscrepancy.cmCount,
        syncIssue: guardianStudentDiscrepancy.syncIssue,
      }
    })
  }, [results, dataType])

  const filteredResults = useMemo(() => {
    let filtered = resultsWithDiscrepancies

    if (statusFilter === "with_discrepancies") {
      filtered = filtered.filter((r) => r.hasDiscrepancies)
    } else if (statusFilter === "unmatched") {
      filtered = filtered.filter((r) => r.matchStatus === "only_partner" || r.matchStatus === "only_cometa")
    } else if (statusFilter === "student_mismatch") {
      filtered = filtered.filter((r) => (r as any).studentMismatch === true)
    } else if (statusFilter === "missing_in_cometa") {
      // Tutores donde PowerSchool tiene MÁS estudiantes que Cometa (faltan sincronizar a Cometa)
      filtered = filtered.filter((r) => (r as any).syncIssue === "missing_in_cometa")
    } else if (statusFilter === "extra_in_cometa") {
      // Tutores donde Cometa tiene MÁS estudiantes que PowerSchool (relaciones que posiblemente sobran)
      filtered = filtered.filter((r) => (r as any).syncIssue === "extra_in_cometa")
    } else if (statusFilter !== "all") {
      filtered = filtered.filter((r) => r.matchStatus === statusFilter)
    }

    if (searchTerm) {
      filtered = filtered.filter((result) => {
        const searchData = {
          ...result.partnerData,
          ...result.cometaData,
          matchReason: result.matchReason,
        }
        return Object.values(searchData).some((value) => String(value).toLowerCase().includes(searchTerm.toLowerCase()))
      })
    }

    // Filtrar estudiantes con grupo W o sin grupo en Cometa
    if (excludeGroupW && dataType === "students") {
      filtered = filtered.filter((result) => {
        const group = getStudentGroup(result.cometaData)
        // Excluir si:
        // - El estudiante está en Cometa (tiene cometaData) Y
        // - No tiene grupo (null/vacío) O tiene grupo "W" o "w" O contiene "sin grupo"
        if (result.cometaData) {
          if (!group) {
            return false // Sin grupo
          }
          const groupUpper = group.toUpperCase()
          if (groupUpper === "W" || groupUpper.includes("SIN GRUPO") || groupUpper === "SIN ASIGNAR") {
            return false // Grupo W o sin asignar
          }
        }
        return true
      })
    }

    return filtered
  }, [resultsWithDiscrepancies, searchTerm, statusFilter, excludeGroupW, dataType])

  const totalPages = Math.ceil(filteredResults.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const currentResults = filteredResults.slice(startIndex, endIndex)

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setCurrentPage(1)
  }

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value)
    setCurrentPage(1)
  }

  const handleRowClick = (student: MatchedStudent) => {
    setSelectedStudent(student)
    setIsModalOpen(true)
  }

  const handleStatClick = (status: string) => {
    setStatusFilter(status)
    setCurrentPage(1)
  }

  // Navegación con teclado para el modal
  const currentStudentIndex = selectedStudent 
    ? filteredResults.findIndex(r => 
        (r.partnerData?.id === selectedStudent.partnerData?.id && r.cometaData?.id === selectedStudent.cometaData?.id) ||
        (r.partnerData?.local_id === selectedStudent.partnerData?.local_id)
      )
    : -1

  const goToPreviousStudent = () => {
    if (currentStudentIndex > 0) {
      setSelectedStudent(filteredResults[currentStudentIndex - 1])
    }
  }

  const goToNextStudent = () => {
    if (currentStudentIndex < filteredResults.length - 1) {
      setSelectedStudent(filteredResults[currentStudentIndex + 1])
    }
  }

  // Escuchar teclas de flecha cuando el modal está abierto
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isModalOpen) return
      
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        goToPreviousStudent()
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        goToNextStudent()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isModalOpen, currentStudentIndex, filteredResults])

  // Limpiar resultado de referencia y verificar existencia cuando cambia el estudiante seleccionado
  useEffect(() => {
    setReferenceResult(null)
    setReferenceStatus(null)
    
    // Verificar si existe referencia cuando se selecciona un estudiante emparejado
    const checkReference = async () => {
      if (!selectedStudent || 
          !tenantIntegrationId || 
          selectedStudent.matchStatus !== "matched" ||
          !selectedStudent.partnerData ||
          !selectedStudent.cometaData) {
        return
      }

      const cometaId = selectedStudent.cometaData?.id || selectedStudent.cometaData?.student_id
      const powerschoolId = selectedStudent.partnerData?.id || selectedStudent.partnerData?.student_id

      if (!cometaId || !powerschoolId) return

      setIsCheckingReference(true)
      try {
        const result = await checkReferenceExists({
          tenantIntegrationId,
          entityType: dataType === "students" ? "student" : "guardian",
          targetEntityId: String(cometaId),
          sourceEntityId: String(powerschoolId),
        })

        setReferenceStatus({
          exists: result.exists,
          reference: result.reference,
          checked: true,
        })
      } catch (error) {
        console.error("Error verificando referencia:", error)
        setReferenceStatus({
          exists: false,
          checked: true,
        })
      } finally {
        setIsCheckingReference(false)
      }
    }

    checkReference()
  }, [selectedStudent, tenantIntegrationId, dataType])

  // Función para crear referencia
  const handleCreateReference = async (student: MatchedStudent) => {
    if (!tenantIntegrationId) {
      setReferenceResult({
        success: false,
        message: "No se ha proporcionado el ID de integración del tenant",
      })
      return
    }

    // Obtener IDs
    const cometaId = student.cometaData?.id || student.cometaData?.student_id
    const powerschoolId = student.partnerData?.id || student.partnerData?.student_id

    if (!cometaId || !powerschoolId) {
      setReferenceResult({
        success: false,
        message: `Faltan IDs: ${!cometaId ? "ID de Cometa" : ""} ${!powerschoolId ? "ID de PowerSchool" : ""}`,
      })
      return
    }

    setIsCreatingReference(true)
    setReferenceResult(null)

    try {
      const result = await createReference({
        tenantIntegrationId,
        entityType: dataType === "students" ? "student" : "guardian",
        targetEntityId: cometaId,
        sourceEntityId: powerschoolId,
        partner: "powerschool",
        allowUpdate: true,
      })

      if (result.success) {
        setReferenceResult({
          success: true,
          message: result.message || "Referencia creada exitosamente",
        })
        // Actualizar el estado para mostrar que ya existe la referencia
        setReferenceStatus({
          exists: true,
          reference: result.data,
          checked: true,
        })
      } else {
        setReferenceResult({
          success: false,
          message: result.error || "Error al crear la referencia",
        })
      }
    } catch (error) {
      setReferenceResult({
        success: false,
        message: error instanceof Error ? error.message : "Error inesperado",
      })
    } finally {
      setIsCreatingReference(false)
    }
  }

  // Función para crear referencias en lote para todos los emparejados
  const handleBulkCreateReferences = async () => {
    if (!tenantIntegrationId) {
      alert("No se ha proporcionado el ID de integración del tenant")
      return
    }

    // Filtrar solo estudiantes emparejados con ambos IDs
    const matchedWithBothIds = resultsWithDiscrepancies.filter(r => {
      if (r.matchStatus !== "matched") return false
      const cometaId = r.cometaData?.id || r.cometaData?.student_id
      const powerschoolId = r.partnerData?.id || r.partnerData?.student_id
      return cometaId && powerschoolId
    })

    if (matchedWithBothIds.length === 0) {
      alert("No hay estudiantes emparejados para crear referencias")
      return
    }

    setIsBulkCreating(true)
    setBulkProgress({ 
      current: 0, 
      total: matchedWithBothIds.length, 
      currentName: "",
      lastAction: "",
      lastMessage: ""
    })
    setBulkResult(null)

    const result = {
      created: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
      details: [] as Array<{ name: string; status: "created" | "exists" | "error"; message: string }>,
    }

    // Loop en el cliente para mostrar progreso en tiempo real
    for (let i = 0; i < matchedWithBothIds.length; i++) {
      const r = matchedWithBothIds[i]
      const cometaId = r.cometaData?.id || r.cometaData?.student_id
      const powerschoolId = r.partnerData?.id || r.partnerData?.student_id
      
      // Construir nombre para mostrar
      const entityName = dataType === "students"
        ? `${r.partnerData?.first_name || ""} ${r.partnerData?.last_name || ""}`.trim() || `ID: ${powerschoolId}`
        : `${r.partnerData?.firstName || r.partnerData?.first_name || ""} ${r.partnerData?.lastName || r.partnerData?.last_name || ""}`.trim() || `ID: ${powerschoolId}`

      // Actualizar progreso antes de procesar
      setBulkProgress({ 
        current: i + 1, 
        total: matchedWithBothIds.length, 
        currentName: entityName,
        lastAction: "",
        lastMessage: `Procesando ${entityName}...`
      })

      try {
        const processResult = await processOneReference({
          tenantIntegrationId,
          entityType: dataType === "students" ? "student" : "guardian",
          targetEntityId: String(cometaId),
          sourceEntityId: String(powerschoolId),
          entityName,
        })

        // Actualizar contadores y detalles
        if (processResult.status === "created") {
          result.created++
        } else if (processResult.status === "exists") {
          result.skipped++
        } else {
          result.failed++
          result.errors.push(`${entityName}: ${processResult.message}`)
        }

        result.details.push({
          name: entityName,
          status: processResult.status,
          message: processResult.message,
        })

        // Actualizar progreso con el resultado
        setBulkProgress(prev => ({ 
          ...prev, 
          lastAction: processResult.status,
          lastMessage: processResult.status === "created" 
            ? `✅ Creada: ${entityName}`
            : processResult.status === "exists"
              ? `⏭️ Ya existe: ${entityName}`
              : `❌ Error: ${entityName}`
        }))

      } catch (error) {
        result.failed++
        const errorMsg = error instanceof Error ? error.message : "Error desconocido"
        result.errors.push(`${entityName}: ${errorMsg}`)
        result.details.push({
          name: entityName,
          status: "error",
          message: errorMsg,
        })
        
        setBulkProgress(prev => ({ 
          ...prev, 
          lastAction: "error",
          lastMessage: `❌ Error: ${entityName}`
        }))
      }

      // Pequeño delay para no saturar y permitir que la UI se actualice
      await new Promise(resolve => setTimeout(resolve, 150))
    }

    setBulkResult(result)
    setIsBulkCreating(false)
  }

  const handleDownloadExcel = () => {
    console.log("[v0] Descargando Excel con filtro:", statusFilter)
    
    // Preparar datos para Excel
    const dataToExport = filteredResults.map((result) => {
      const isOnlyCometa = result.matchStatus === "only_cometa"
      const isOnlyPartner = result.matchStatus === "only_partner"
      const isMatched = result.matchStatus === "matched"
      
      // Determinar qué datos usar según el status
      const sourceData = isOnlyCometa 
        ? result.cometaData 
        : isOnlyPartner 
          ? result.partnerData 
          : result.partnerData || result.cometaData // Para matched, preferir PowerSchool
      
      if (dataType === "students") {
        return {
          "Estado": STATUS_CONFIG[result.matchStatus]?.label || result.matchStatus,
          "Nombre": sourceData?.first_name || "",
          "Apellido": sourceData?.last_name || "",
          "ID PowerSchool": result.partnerData?.id || "-",
          "ID Cometa": result.cometaData?.id || "-",
          "Matrícula": sourceData?.local_id || sourceData?.enrollment_code || "",
          "CURP": sourceData?.curp || "",
          "Fecha Nacimiento": sourceData?.dob || "",
          "Género": sourceData?.gender || "",
          "Grado": sourceData?.grade || "",
          "Grupo": sourceData?.section ? formatSection(sourceData.section) : "",
          "Email": sourceData?.email || "",
          "ID Escuela": sourceData?.school_id || "",
          "Razón de Matching": result.matchReason || "",
          "Tiene Discrepancias": result.hasDiscrepancies ? "Sí" : "No",
        }
      } else {
        // Para guardians/tutores
        const partnerStudents = result.partnerData?.students || 
          (result.partnerData?.student_id ? [{ student_name: result.partnerData.student_name }] : [])
        
        const cometaStudents = result.cometaData?.students || 
          (result.cometaData?.student_id ? [{ student_name: result.cometaData.student_name }] : [])

        return {
          "Estado": STATUS_CONFIG[result.matchStatus]?.label || result.matchStatus,
          "Nombre": sourceData?.firstName || sourceData?.first_name || "",
          "Apellido": sourceData?.lastName || sourceData?.last_name || "",
          "ID PowerSchool": result.partnerData?.id || "-",
          "ID Cometa": result.cometaData?.id || "-",
          "Email": sourceData?.email || "",
          "Teléfono": sourceData?.phone || "",
          "Relación": sourceData?.relationship || "",
          "Estudiantes PowerSchool": partnerStudents.map((s: any) => s.student_name || "").join(", "),
          "Estudiantes Cometa": cometaStudents.map((s: any) => s.student_name || "").join(", "),
          "Discrepancia Estudiantes": (result as any).studentMismatch ? "Sí" : "No",
          "Razón de Matching": result.matchReason || "",
          "Tiene Discrepancias": result.hasDiscrepancies ? "Sí" : "No",
        }
      }
    })
    
    // Crear worksheet
    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    
    // Ajustar anchos de columna
    const columnWidths = Object.keys(dataToExport[0] || {}).map(key => ({
      wch: Math.max(key.length, 15)
    }))
    worksheet['!cols'] = columnWidths
    
    // Crear workbook
    const workbook = XLSX.utils.book_new()
    const sheetName = dataType === "students" ? "Estudiantes" : "Tutores"
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
    
    // Determinar nombre de archivo según filtro
    const filterLabel = statusFilter === "only_cometa" 
      ? "solo-cometa"
      : statusFilter === "only_partner"
        ? "solo-powerschool"
        : statusFilter === "matched"
          ? "emparejados"
          : statusFilter === "with_discrepancies"
            ? "con-discrepancias"
            : "todos"
    
    const entityType = dataType === "students" ? "estudiantes" : "tutores"
    const today = new Date().toISOString().split('T')[0]
    const fileName = `${entityType}-${filterLabel}-${today}.xlsx`
    
    // Descargar archivo
    XLSX.writeFile(workbook, fileName)
    
    console.log(`[v0] ✅ Descargado ${dataToExport.length} registros en ${fileName}`)
  }

  const handleDownloadMismatch = () => {
    const mismatchResults = resultsWithDiscrepancies.filter((r) => (r as any).studentMismatch === true)
    
    if (mismatchResults.length === 0) return

    const dataToExport = mismatchResults.map((result) => {
      const sourceData = result.partnerData || result.cometaData
      const partnerStudents = result.partnerData?.students || 
        (result.partnerData?.student_id ? [{ student_name: result.partnerData.student_name }] : [])
      
      const cometaStudents = result.cometaData?.students || 
        (result.cometaData?.student_id ? [{ student_name: result.cometaData.student_name }] : [])

      return {
        "Estado": STATUS_CONFIG[result.matchStatus]?.label || result.matchStatus,
        "Nombre": sourceData?.firstName || sourceData?.first_name || "",
        "Apellido": sourceData?.lastName || sourceData?.last_name || "",
        "ID PowerSchool": result.partnerData?.id || "-",
        "ID Cometa": result.cometaData?.id || "-",
        "Email": sourceData?.email || "",
        "Teléfono": sourceData?.phone || "",
        "Estudiantes PowerSchool": partnerStudents.map((s: any) => s.student_name || "").join(", "),
        "Estudiantes Cometa": cometaStudents.map((s: any) => s.student_name || "").join(", "),
        "Motivo de Diferencia": (result as any).studentMismatchReason || "Estudiantes no coinciden",
        "Razón de Matching": result.matchReason || "",
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    const columnWidths = Object.keys(dataToExport[0] || {}).map(key => ({
      wch: Math.max(key.length, 25)
    }))
    worksheet['!cols'] = columnWidths
    
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tutores con Diferencias")
    
    const today = new Date().toISOString().split('T')[0]
    XLSX.writeFile(workbook, `tutores-diferencias-estudiantes-${today}.xlsx`)
  }

  const handleDownloadDiscrepanciesDetail = () => {
    // Filtrar solo los que tienen discrepancias
    const discrepancyResults = resultsWithDiscrepancies.filter((r) => r.hasDiscrepancies)
    
    if (discrepancyResults.length === 0) return

    const dataToExport: any[] = []

    discrepancyResults.forEach((result) => {
      // Calcular discrepancias para este registro
      const discrepancies = dataType === "guardians"
        ? compareGuardianData(result.partnerData, result.cometaData)
        : compareStudentData(result.partnerData, result.cometaData)

      const entityName = dataType === "students"
        ? `${result.partnerData?.first_name || result.cometaData?.first_name || ""} ${result.partnerData?.middle_name || result.cometaData?.middle_name || ""} ${result.partnerData?.last_name || result.cometaData?.last_name || ""}`.replace(/\s+/g, " ").trim()
        : `${result.partnerData?.firstName || result.partnerData?.first_name || result.cometaData?.first_name || ""} ${result.partnerData?.lastName || result.partnerData?.last_name || result.cometaData?.last_name || ""}`.trim()

      const matricula = result.partnerData?.local_id || result.cometaData?.enrollment_code || "-"

      // Si hay discrepancias de campos, agregar una fila por cada discrepancia
      if (Object.keys(discrepancies).length > 0) {
        Object.entries(discrepancies).forEach(([field, values]: [string, any]) => {
          dataToExport.push({
            "Nombre": entityName,
            "Matrícula": matricula,
            "ID PowerSchool": result.partnerData?.id || "-",
            "ID Cometa": result.cometaData?.id || "-",
            "Campo": field,
            "Valor PowerSchool": values.partner || "-",
            "Valor Cometa": values.cometa || "-",
            "Razón de Match": result.matchReason || "-",
          })
        })
      }
    })

    if (dataToExport.length === 0) {
      console.log("[v0] No hay discrepancias de campos para exportar")
      return
    }

    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    const columnWidths = [
      { wch: 35 }, // Nombre
      { wch: 12 }, // Matrícula
      { wch: 15 }, // ID PowerSchool
      { wch: 15 }, // ID Cometa
      { wch: 20 }, // Campo
      { wch: 35 }, // Valor PowerSchool
      { wch: 35 }, // Valor Cometa
      { wch: 20 }, // Razón de Match
    ]
    worksheet['!cols'] = columnWidths
    
    const workbook = XLSX.utils.book_new()
    const sheetName = dataType === "students" ? "Discrepancias Estudiantes" : "Discrepancias Tutores"
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
    
    const entityType = dataType === "students" ? "estudiantes" : "tutores"
    const today = new Date().toISOString().split('T')[0]
    XLSX.writeFile(workbook, `discrepancias-detalle-${entityType}-${today}.xlsx`)
    
    console.log(`[v0] ✅ Descargadas ${dataToExport.length} discrepancias en detalle`)
  }

  const handleDownloadSyncIssues = () => {
    // Obtener tutores con relaciones extra en Cometa (más hijos en Cometa que en PowerSchool)
    const extraInCometaResults = resultsWithDiscrepancies.filter((r) => (r as any).syncIssue === "extra_in_cometa")
    
    if (extraInCometaResults.length === 0) return

    // Normalizar nombre para comparación
    const normalizeName = (name: string) => {
      return (name || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
    }

    const dataToExport = extraInCometaResults.map((result) => {
      const sourceData = result.partnerData || result.cometaData
      
      // Obtener estudiantes de cada sistema
      const partnerStudents = result.partnerData?.students || 
        (result.partnerData?.student_id ? [{ 
          student_name: result.partnerData.student_name,
          student_id: result.partnerData.student_id 
        }] : [])
      
      const cometaStudents = result.cometaData?.students || 
        (result.cometaData?.student_id ? [{ 
          student_name: result.cometaData.student_name,
          student_id: result.cometaData.student_id 
        }] : [])

      // Identificar estudiantes en Cometa que NO están en PowerSchool
      const psNormalizedNames = partnerStudents.map((s: any) => normalizeName(s.student_name || ""))
      
      const studentsOnlyInCometa = cometaStudents.filter((cmStudent: any) => {
        const cmNormalized = normalizeName(cmStudent.student_name || "")
        return !psNormalizedNames.some((psName: string) => psName === cmNormalized)
      })

      // Formatear la información de manera clara
      const formatStudentList = (students: any[], includeId = true) => {
        if (!students || students.length === 0) return "Ninguno"
        return students.map((s: any) => {
          const name = s.student_name || "Sin nombre"
          const id = s.student_id || s.id || ""
          return includeId && id ? `${name} (ID: ${id})` : name
        }).join(" | ")
      }

      return {
        "Tutor - Nombre Completo": `${sourceData?.firstName || sourceData?.first_name || ""} ${sourceData?.lastName || sourceData?.last_name || ""}`.trim(),
        "Email": sourceData?.emails || sourceData?.email || "-",
        "Teléfono": sourceData?.phones || sourceData?.phone || "-",
        "# Estudiantes PowerSchool": partnerStudents.length,
        "# Estudiantes Cometa": cometaStudents.length,
        "Estudiantes en PowerSchool": formatStudentList(partnerStudents),
        "Estudiantes en Cometa": formatStudentList(cometaStudents),
        "⚠️ RELACIONES SIN SINCRONIZAR (en Cometa pero NO en PowerSchool)": formatStudentList(studentsOnlyInCometa),
        "Cantidad de Relaciones Faltantes": studentsOnlyInCometa.length,
        "ID Tutor PowerSchool": result.partnerData?.id || "-",
        "ID Tutor Cometa": result.cometaData?.id || "-",
      }
    })

    // Ordenar por cantidad de relaciones faltantes (mayor a menor)
    dataToExport.sort((a, b) => b["Cantidad de Relaciones Faltantes"] - a["Cantidad de Relaciones Faltantes"])

    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    
    // Ajustar anchos de columna para mejor legibilidad
    worksheet['!cols'] = [
      { wch: 35 },  // Nombre
      { wch: 30 },  // Email
      { wch: 18 },  // Teléfono
      { wch: 12 },  // # PS
      { wch: 12 },  // # Cometa
      { wch: 50 },  // Estudiantes PS
      { wch: 50 },  // Estudiantes Cometa
      { wch: 60 },  // Relaciones faltantes
      { wch: 15 },  // Cantidad faltantes
      { wch: 20 },  // ID Tutor PS
      { wch: 38 },  // ID Tutor Cometa
    ]
    
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Relaciones Faltantes en PS")
    
    const today = new Date().toISOString().split('T')[0]
    XLSX.writeFile(workbook, `tutores-relaciones-faltantes-powerschool-${today}.xlsx`)
  }

  const stats = useMemo(() => {
    return {
      matched: resultsWithDiscrepancies.filter((r) => r.matchStatus === "matched").length,
      only_partner: resultsWithDiscrepancies.filter((r) => r.matchStatus === "only_partner").length,
      only_cometa: resultsWithDiscrepancies.filter((r) => r.matchStatus === "only_cometa").length,
      conflict_duplicate: resultsWithDiscrepancies.filter((r) => r.matchStatus === "conflict_duplicate").length,
      unmatched: resultsWithDiscrepancies.filter(
        (r) => r.matchStatus === "only_partner" || r.matchStatus === "only_cometa",
      ).length,
      with_discrepancies: resultsWithDiscrepancies.filter((r) => r.hasDiscrepancies).length,
      student_mismatch: resultsWithDiscrepancies.filter((r) => (r as any).studentMismatch === true).length,
      // NUEVAS ESTADÍSTICAS DE SINCRONIZACIÓN
      missing_in_cometa: resultsWithDiscrepancies.filter((r) => (r as any).syncIssue === "missing_in_cometa").length,
      extra_in_cometa: resultsWithDiscrepancies.filter((r) => (r as any).syncIssue === "extra_in_cometa").length,
    }
  }, [resultsWithDiscrepancies])

  const getMostRecentInscription = (inscriptions: any) => {
    if (!inscriptions) return null
    if (typeof inscriptions === "string") {
      try {
        inscriptions = JSON.parse(inscriptions)
      } catch {
        return null
      }
    }
    if (!Array.isArray(inscriptions) || inscriptions.length === 0) return null

    // Ordenar por fecha y tomar la más reciente
    const sorted = [...inscriptions].sort((a, b) => {
      const dateA = new Date(a.created_at || a.date || 0)
      const dateB = new Date(b.created_at || b.date || 0)
      return dateB.getTime() - dateA.getTime()
    })

    return sorted[0]
  }

  return (
    <>
      <Card className="border-neutral-200 bg-gradient-to-br from-white to-neutral-25 shadow-lg w-full">
        <CardHeader className="border-b border-neutral-100 bg-white/80 backdrop-blur-sm">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-neutral-900 font-lota text-2xl font-semibold">
                Resultados del Matching
              </CardTitle>
              <CardDescription className="text-neutral-600">
                Comparación entre estudiantes de PowerSchool y Cometa
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                variant="secondary"
                className="bg-galaxy-50 text-galaxy-700 border-galaxy-200 px-3 py-1.5 text-sm font-semibold"
              >
                {filteredResults.length} resultados
              </Badge>
              
              {filteredResults.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {dataType === "guardians" && stats.extra_in_cometa > 0 && (
                    <Button
                      onClick={handleDownloadSyncIssues}
                      variant="outline"
                      size="sm"
                      className="border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-700"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      📋 Relaciones Faltantes ({stats.extra_in_cometa})
                    </Button>
                  )}
                  {dataType === "guardians" && stats.student_mismatch > 0 && (
                    <Button
                      onClick={handleDownloadMismatch}
                      variant="outline"
                      size="sm"
                      className="border-red-300 bg-red-50 hover:bg-red-100 text-red-700"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Descargar Diferencias
                    </Button>
                  )}
                  {stats.with_discrepancies > 0 && (
                    <Button
                      onClick={handleDownloadDiscrepanciesDetail}
                      variant="outline"
                      size="sm"
                      className="border-orange-300 bg-orange-50 hover:bg-orange-100 text-orange-700"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      📊 Discrepancias Detalle ({stats.with_discrepancies})
                    </Button>
                  )}
                  <Button
                    onClick={handleDownloadExcel}
                    variant="outline"
                    size="sm"
                    className="border-galaxy-300 hover:bg-galaxy-50 text-galaxy-700"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Descargar Excel
                  </Button>
                  
                  {/* Botón para crear referencias en lote */}
                  {tenantIntegrationId && stats.matched > 0 && (
                    <Button
                      onClick={handleBulkCreateReferences}
                      disabled={isBulkCreating}
                      size="sm"
                      className="bg-galaxy-600 hover:bg-galaxy-700 text-white"
                    >
                      {isBulkCreating ? (
                        <>
                          <Spinner className="h-4 w-4 mr-2" />
                          Creando...
                        </>
                      ) : (
                        <>
                          <LinkIcon className="h-4 w-4 mr-2" />
                          🔗 Crear Referencias ({stats.matched})
                        </>
                      )}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Progreso y resultados de creación en lote */}
          {(isBulkCreating || bulkResult) && (
            <div className="mt-4 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
              {isBulkCreating && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-neutral-700">
                      Procesando referencias...
                    </span>
                    <span className="text-sm font-semibold text-galaxy-600">
                      {bulkProgress.current} / {bulkProgress.total}
                    </span>
                  </div>
                  
                  <Progress 
                    value={bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0} 
                    className="h-3"
                  />
                  
                  {/* Información del elemento actual */}
                  {bulkProgress.currentName && (
                    <div className="flex items-center gap-2 text-sm">
                      <Spinner className="h-4 w-4" />
                      <span className="text-neutral-600">Procesando:</span>
                      <span className="font-medium text-neutral-900">{bulkProgress.currentName}</span>
                    </div>
                  )}
                  
                  {/* Última acción realizada */}
                  {bulkProgress.lastMessage && (
                    <div className={`text-sm p-2 rounded ${
                      bulkProgress.lastAction === "created" 
                        ? "bg-success-50 text-success-700" 
                        : bulkProgress.lastAction === "exists"
                          ? "bg-blue-50 text-blue-700"
                          : bulkProgress.lastAction === "error"
                            ? "bg-error-50 text-error-700"
                            : "bg-neutral-100 text-neutral-600"
                    }`}>
                      {bulkProgress.lastMessage}
                    </div>
                  )}
                </div>
              )}
              
              {bulkResult && !isBulkCreating && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-neutral-900 text-lg">
                      ✅ Proceso completado
                    </h4>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setBulkResult(null)}
                      className="text-neutral-500 hover:text-neutral-700"
                    >
                      ✕ Cerrar
                    </Button>
                  </div>
                  
                  {/* Resumen */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-success-50 rounded-lg border border-success-200 text-center">
                      <p className="text-3xl font-bold text-success-700">{bulkResult.created}</p>
                      <p className="text-sm text-success-600 font-medium">✅ Creadas</p>
                    </div>
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 text-center">
                      <p className="text-3xl font-bold text-blue-700">{bulkResult.skipped}</p>
                      <p className="text-sm text-blue-600 font-medium">⏭️ Ya existían</p>
                    </div>
                    <div className="p-4 bg-error-50 rounded-lg border border-error-200 text-center">
                      <p className="text-3xl font-bold text-error-700">{bulkResult.failed}</p>
                      <p className="text-sm text-error-600 font-medium">❌ Errores</p>
                    </div>
                  </div>
                  
                  {/* Detalle de todas las operaciones */}
                  {bulkResult.details && bulkResult.details.length > 0 && (
                    <div className="mt-3">
                      <p className="text-sm font-medium text-neutral-700 mb-2">Detalle de operaciones:</p>
                      <div className="max-h-48 overflow-y-auto space-y-1 bg-white rounded border border-neutral-200 p-2">
                        {bulkResult.details.map((detail, i) => (
                          <div 
                            key={i} 
                            className={`text-xs p-2 rounded flex items-center gap-2 ${
                              detail.status === "created" 
                                ? "bg-success-50 text-success-700" 
                                : detail.status === "exists"
                                  ? "bg-blue-50 text-blue-700"
                                  : "bg-error-50 text-error-700"
                            }`}
                          >
                            <span>
                              {detail.status === "created" ? "✅" : detail.status === "exists" ? "⏭️" : "❌"}
                            </span>
                            <span className="font-medium">{detail.name}</span>
                            <span className="text-neutral-500">—</span>
                            <span>{detail.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Errores específicos */}
                  {bulkResult.errors.length > 0 && (
                    <div className="p-3 bg-error-50 rounded border border-error-200">
                      <p className="text-sm font-medium text-error-700 mb-2">⚠️ Errores encontrados:</p>
                      <ul className="text-xs text-error-600 space-y-1 max-h-32 overflow-y-auto">
                        {bulkResult.errors.map((error, i) => (
                          <li key={i}>• {error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
            <Card
              className={`border-success-200 bg-success-50 cursor-pointer transition-all hover:shadow-md ${statusFilter === "matched" ? "ring-2 ring-success-400" : ""}`}
              onClick={() => handleStatClick("matched")}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success-500" />
                  <div>
                    <p className="text-xs text-success-600 font-medium">Emparejados</p>
                    <p className="text-lg font-bold text-success-700">{stats.matched}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-warning-200 bg-warning-50 cursor-pointer transition-all hover:shadow-md ${statusFilter === "only_partner" ? "ring-2 ring-warning-400" : ""}`}
              onClick={() => handleStatClick("only_partner")}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-warning-500" />
                  <div>
                    <p className="text-xs text-warning-600 font-medium">Solo Partner</p>
                    <p className="text-lg font-bold text-warning-700">{stats.only_partner}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-aurora-200 bg-aurora-50 cursor-pointer transition-all hover:shadow-md ${statusFilter === "only_cometa" ? "ring-2 ring-aurora-400" : ""}`}
              onClick={() => handleStatClick("only_cometa")}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-aurora-500" />
                  <div>
                    <p className="text-xs text-aurora-600 font-medium">Solo Cometa</p>
                    <p className="text-lg font-bold text-aurora-700">{stats.only_cometa}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-error-200 bg-error-50 cursor-pointer transition-all hover:shadow-md ${statusFilter === "unmatched" ? "ring-2 ring-error-400" : ""}`}
              onClick={() => handleStatClick("unmatched")}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-error-500" />
                  <div>
                    <p className="text-xs text-error-600 font-medium">No Emparejados</p>
                    <p className="text-lg font-bold text-error-700">{stats.unmatched}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-orange-200 bg-orange-50 cursor-pointer transition-all hover:shadow-md ${statusFilter === "with_discrepancies" ? "ring-2 ring-orange-400" : ""}`}
              onClick={() => handleStatClick("with_discrepancies")}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  <div>
                    <p className="text-xs text-orange-600 font-medium">Con Discrepancias</p>
                    <p className="text-lg font-bold text-orange-700">{stats.with_discrepancies}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-neutral-200 bg-neutral-50 cursor-pointer transition-all hover:shadow-md ${statusFilter === "conflict_duplicate" ? "ring-2 ring-neutral-400" : ""}`}
              onClick={() => handleStatClick("conflict_duplicate")}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-neutral-500" />
                  <div>
                    <p className="text-xs text-neutral-600 font-medium">Conflictos</p>
                    <p className="text-lg font-bold text-neutral-700">{stats.conflict_duplicate}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {dataType === "guardians" && stats.student_mismatch > 0 && (
              <Card
                className={`border-red-200 bg-red-50 cursor-pointer transition-all hover:shadow-md ${statusFilter === "student_mismatch" ? "ring-2 ring-red-400" : ""}`}
                onClick={() => handleStatClick("student_mismatch")}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <div>
                      <p className="text-xs text-red-600 font-medium">Estudiante Diferente</p>
                      <p className="text-lg font-bold text-red-700">{stats.student_mismatch}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Estadísticas de sincronización para tutores */}
          {dataType === "guardians" && (stats.missing_in_cometa > 0 || stats.extra_in_cometa > 0) && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Card
                className={`border-blue-200 bg-blue-50 cursor-pointer transition-all hover:shadow-md ${statusFilter === "missing_in_cometa" ? "ring-2 ring-blue-400" : ""}`}
                onClick={() => handleStatClick("missing_in_cometa")}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-blue-500" />
                    <div>
                      <p className="text-xs text-blue-600 font-medium">⬇️ Faltan en Cometa</p>
                      <p className="text-lg font-bold text-blue-700">{stats.missing_in_cometa}</p>
                      <p className="text-[10px] text-blue-500">PowerSchool tiene más hijos</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={`border-purple-200 bg-purple-50 cursor-pointer transition-all hover:shadow-md ${statusFilter === "extra_in_cometa" ? "ring-2 ring-purple-400" : ""}`}
                onClick={() => handleStatClick("extra_in_cometa")}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-purple-500" />
                    <div>
                      <p className="text-xs text-purple-600 font-medium">⬆️ Extra en Cometa</p>
                      <p className="text-lg font-bold text-purple-700">{stats.extra_in_cometa}</p>
                      <p className="text-[10px] text-purple-500">Cometa tiene más hijos que PS</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          <div className="flex gap-3">
            <div className="relative group flex-1">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-neutral-400 group-focus-within:text-galaxy-500 transition-colors" />
              <Input
                type="text"
                placeholder="Buscar por nombre, matrícula, CURP..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-12 h-12 border-neutral-200 bg-white focus:border-galaxy-400 focus:ring-2 focus:ring-galaxy-100 text-neutral-900 placeholder:text-neutral-400 rounded-xl shadow-sm transition-all"
              />
              {searchTerm && (
                <button
                  onClick={() => handleSearchChange("")}
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  <span className="text-sm font-medium">Limpiar</span>
                </button>
              )}
            </div>

            <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
              <SelectTrigger className="w-[220px] h-12 border-neutral-200 bg-white rounded-xl shadow-sm">
                <SelectValue placeholder="Filtrar por estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="matched">Emparejados</SelectItem>
                <SelectItem value="unmatched">No Emparejados</SelectItem>
                <SelectItem value="with_discrepancies">Con Discrepancias</SelectItem>
                {dataType === "guardians" && stats.student_mismatch > 0 && (
                  <SelectItem value="student_mismatch">Estudiante Diferente</SelectItem>
                )}
                {dataType === "guardians" && stats.missing_in_cometa > 0 && (
                  <SelectItem value="missing_in_cometa">⬇️ Faltan en Cometa</SelectItem>
                )}
                {dataType === "guardians" && stats.extra_in_cometa > 0 && (
                  <SelectItem value="extra_in_cometa">⬆️ Extra en Cometa</SelectItem>
                )}
                <SelectItem value="only_partner">Solo Partner</SelectItem>
                <SelectItem value="only_cometa">Solo Cometa</SelectItem>
                <SelectItem value="conflict_duplicate">Conflictos</SelectItem>
              </SelectContent>
            </Select>

            {/* Filtro para excluir grupo W o sin grupo */}
            {dataType === "students" && (
              <label className="flex items-center gap-2 px-4 h-12 border border-neutral-200 bg-white rounded-xl shadow-sm cursor-pointer hover:bg-neutral-50 transition-colors">
                <input
                  type="checkbox"
                  checked={excludeGroupW}
                  onChange={(e) => setExcludeGroupW(e.target.checked)}
                  className="w-4 h-4 text-galaxy-600 border-neutral-300 rounded focus:ring-galaxy-500"
                />
                <span className="text-sm text-neutral-700 whitespace-nowrap">
                  Ocultar grupo W / sin grupo
                </span>
              </label>
            )}
          </div>

          <div className="border border-neutral-200 rounded-xl overflow-hidden shadow-sm bg-white">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-neutral-50 to-neutral-25 border-b border-neutral-200 hover:bg-neutral-50">
                    <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                      Estado
                    </TableHead>
                    <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                      Nombre (Partner)
                    </TableHead>
                    <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                      Nombre (Cometa)
                    </TableHead>
                    {dataType === "students" ? (
                      <>
                        <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                          Matrícula
                        </TableHead>
                        <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                          Estado Estudiante
                        </TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                          Email
                        </TableHead>
                        <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                          Teléfono
                        </TableHead>
                        <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                          Estudiante Asociado
                        </TableHead>
                      </>
                    )}
                    <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                      Razón de Match
                    </TableHead>
                    <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                      Confianza
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentResults.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-16 text-neutral-500">
                        <div className="flex flex-col items-center gap-3">
                          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100">
                            <Search className="h-8 w-8 text-neutral-400" />
                          </div>
                          <div className="space-y-1">
                            <p className="font-medium text-neutral-700">No se encontraron resultados</p>
                            <p className="text-sm text-neutral-500">Intenta con otros términos de búsqueda o filtros</p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    currentResults.map((result, index) => {
                      const config = STATUS_CONFIG[result.matchStatus]
                      const Icon = config.icon
                      const partnerName =
                        result.partnerData?.first_name && result.partnerData?.last_name
                          ? `${result.partnerData.first_name} ${result.partnerData.middle_name || ""} ${result.partnerData.last_name}`.replace(/\s+/g, " ").trim()
                          : result.partnerData?.firstName && result.partnerData?.lastName
                            ? `${result.partnerData.firstName} ${result.partnerData.middleName || ""} ${result.partnerData.lastName}`.replace(/\s+/g, " ").trim()
                            : result.partnerData?.nombre || "-"
                      const cometaName =
                        result.cometaData?.first_name && result.cometaData?.last_name
                          ? `${result.cometaData.first_name} ${result.cometaData.middle_name || ""} ${result.cometaData.last_name}`.replace(/\s+/g, " ").trim()
                          : result.cometaData?.nombre || "-"

                      const specificData =
                        dataType === "students"
                          ? {
                              col1: result.partnerData?.local_id || result.cometaData?.enrollment_code || "-",
                              col2: result.cometaData?.state || result.partnerData?.enroll_status || "-",
                              col3: null,
                            }
                          : {
                              col1: result.partnerData?.emails || result.cometaData?.email || "-",
                              col2: result.partnerData?.phones || result.cometaData?.phone || "-",
                              col3: {
                                partnerStudentId: result.partnerData?.student_id || "-",
                                cometaStudentId: result.cometaData?.student_id || "-",
                                mismatch: (result as any).studentMismatch === true,
                              },
                            }

                      const isDeleted = result.cometaData?.deleted_at || result.partnerData?.deleted_at
                      const isInactive =
                        specificData.col2?.toLowerCase() === "inactive" ||
                        specificData.col2?.toLowerCase() === "inactivo"

                      return (
                        <TableRow
                          key={index}
                          onClick={() => handleRowClick(result)}
                          className="hover:bg-galaxy-50/50 transition-colors border-b border-neutral-100 last:border-0 cursor-pointer"
                        >
                          <TableCell className="py-4 px-6">
                            <div className="flex flex-col gap-1.5">
                              <Badge variant="secondary" className={`${config.color} flex items-center gap-1.5 w-fit`}>
                                <Icon className={`h-3.5 w-3.5 ${config.iconColor}`} />
                                {config.label}
                              </Badge>
                              {result.hasDiscrepancies && (
                                <Badge
                                  variant="secondary"
                                  className="bg-orange-50 text-orange-700 border-orange-200 flex items-center gap-1 w-fit text-xs"
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  {result.discrepanciesCount} diferencia{result.discrepanciesCount !== 1 ? "s" : ""}
                                  {result.hasGuardianDiscrepancy && <span className="ml-1">(📋 Tutores)</span>}
                                </Badge>
                              )}
                              {(result as any).studentMismatch && (
                                <Badge
                                  variant="secondary"
                                  className="bg-red-50 text-red-700 border-red-200 flex items-center gap-1 w-fit text-xs"
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  Estudiante Diferente
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-neutral-700 py-4 px-6 font-medium text-sm">
                            {partnerName}
                          </TableCell>
                          <TableCell className="text-neutral-700 py-4 px-6 font-medium text-sm">{cometaName}</TableCell>
                          <TableCell className="text-neutral-700 py-4 px-6 font-mono text-sm">
                            {specificData.col1}
                          </TableCell>
                          <TableCell className="py-4 px-6">
                            {dataType === "students" ? (
                              <div className="flex flex-col gap-1.5">
                                {isDeleted ? (
                                  <Badge
                                    variant="secondary"
                                    className="bg-error-50 text-error-700 border-error-200 w-fit"
                                  >
                                    Eliminado
                                  </Badge>
                                ) : isInactive ? (
                                  <Badge
                                    variant="secondary"
                                    className="bg-warning-50 text-warning-700 border-warning-200 w-fit"
                                  >
                                    Inactivo
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="secondary"
                                    className="bg-success-50 text-success-700 border-success-200 w-fit"
                                  >
                                    Activo
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-neutral-700 font-mono text-sm">{specificData.col2}</span>
                            )}
                          </TableCell>
                          {dataType === "guardians" && specificData.col3 && (
                            <TableCell className="py-4 px-6">
                              <div className="flex flex-col gap-2">
                                <div className="flex flex-col gap-1">
                                  {(() => {
                                    const psStudents = result.partnerData?.students || 
                                      (result.partnerData?.student_id ? [{
                                        student_id: result.partnerData.student_id,
                                        student_name: result.partnerData.student_name,
                                        student_local_id: result.partnerData.student_local_id
                                      }] : [])
                                    
                                    return (
                                      <>
                                        <span className="text-xs text-neutral-500 font-medium">
                                          PowerSchool ({psStudents.length}):
                                        </span>
                                        {psStudents.slice(0, 2).map((s: any, idx: number) => (
                                          <div key={idx} className="text-xs">
                                            <span className="font-semibold text-neutral-900">{s.student_name || "-"}</span>
                                          </div>
                                        ))}
                                        {psStudents.length > 2 && (
                                          <span className="text-xs text-neutral-500 italic">
                                            +{psStudents.length - 2} más
                                          </span>
                                        )}
                                      </>
                                    )
                                  })()}
                                </div>
                                <div className="flex flex-col gap-1">
                                  {(() => {
                                    const cmStudents = result.cometaData?.students || 
                                      (result.cometaData?.student_id ? [{
                                        student_id: result.cometaData.student_id,
                                        student_name: result.cometaData.student_name,
                                        student_identifier: result.cometaData.student_identifier
                                      }] : [])
                                    
                                    return (
                                      <>
                                        <span className="text-xs text-neutral-500 font-medium">
                                          Cometa ({cmStudents.length}):
                                        </span>
                                        {cmStudents.slice(0, 2).map((s: any, idx: number) => (
                                          <div key={idx} className="text-xs">
                                            <span className="font-semibold text-neutral-900">{s.student_name || "-"}</span>
                                          </div>
                                        ))}
                                        {cmStudents.length > 2 && (
                                          <span className="text-xs text-neutral-500 italic">
                                            +{cmStudents.length - 2} más
                                          </span>
                                        )}
                                      </>
                                    )
                                  })()}
                                </div>
                                {specificData.col3.mismatch && (
                                  <Badge
                                    variant="secondary"
                                    className="bg-red-50 text-red-700 border-red-200 w-fit text-xs mt-1"
                                  >
                                    ⚠️ Diferente
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                          )}
                          <TableCell className="text-neutral-700 py-4 px-6 text-sm">
                            {result.matchReason ? (
                              <Badge variant="outline" className="font-mono text-xs">
                                {result.matchReason}
                              </Badge>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className="text-neutral-700 py-4 px-6 text-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-2 bg-neutral-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-galaxy-500 transition-all"
                                  style={{ width: `${result.confidence * 100}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium">{Math.round(result.confidence * 100)}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <p className="text-sm text-neutral-600 font-medium">
                  Mostrando{" "}
                  <span className="text-neutral-900 font-semibold">
                    {startIndex + 1}-{Math.min(endIndex, filteredResults.length)}
                  </span>{" "}
                  de <span className="text-neutral-900 font-semibold">{filteredResults.length}</span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="border-neutral-300 hover:border-galaxy-400 hover:bg-galaxy-50 hover:text-galaxy-700 disabled:opacity-40 disabled:cursor-not-allowed bg-white h-9 px-4 font-medium transition-all"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Anterior
                </Button>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-50 rounded-lg border border-neutral-200">
                  <span className="text-sm font-medium text-neutral-600">Página</span>
                  <span className="text-sm font-bold text-neutral-900">{currentPage}</span>
                  <span className="text-sm text-neutral-400">/</span>
                  <span className="text-sm font-medium text-neutral-600">{totalPages}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="border-neutral-300 hover:border-galaxy-400 hover:bg-galaxy-50 hover:text-galaxy-700 disabled:opacity-40 disabled:cursor-not-allowed bg-white h-9 px-4 font-medium transition-all"
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-[98vw] lg:max-w-[90vw] max-h-[95vh] overflow-y-auto">
          {/* Botones de navegación */}
          <div className="flex items-center justify-between mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPreviousStudent}
              disabled={currentStudentIndex <= 0}
              className="flex items-center gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <span className="text-sm text-neutral-500">
              {currentStudentIndex + 1} de {filteredResults.length}
              <span className="ml-2 text-xs text-neutral-400">(← →)</span>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={goToNextStudent}
              disabled={currentStudentIndex >= filteredResults.length - 1}
              className="flex items-center gap-1"
            >
              Siguiente
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <DialogHeader>
            <DialogTitle className="text-2xl font-lota text-neutral-900">
              {dataType === "guardians" ? "Detalles del Tutor" : "Detalles del Estudiante"}
            </DialogTitle>
            <DialogDescription className="text-neutral-600">
              Información completa de PowerSchool y Cometa
            </DialogDescription>
          </DialogHeader>

          {selectedStudent && (
            <div className="space-y-6 mt-4">
              <div className="flex items-center gap-3 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
                <Badge
                  variant="secondary"
                  className={`${STATUS_CONFIG[selectedStudent.matchStatus].color} flex items-center gap-1.5`}
                >
                  {(() => {
                    const Icon = STATUS_CONFIG[selectedStudent.matchStatus].icon
                    return <Icon className={`h-4 w-4 ${STATUS_CONFIG[selectedStudent.matchStatus].iconColor}`} />
                  })()}
                  {STATUS_CONFIG[selectedStudent.matchStatus].label}
                </Badge>
                {selectedStudent.matchReason && (
                  <Badge variant="outline" className="font-mono">
                    {selectedStudent.matchReason}
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-sm text-neutral-600">Confianza:</span>
                  <span className="text-sm font-bold text-neutral-900">
                    {Math.round(selectedStudent.confidence * 100)}%
                  </span>
                </div>
              </div>

              {/* Sección de Referencia - solo si está emparejado y tiene ambos IDs */}
              {selectedStudent.matchStatus === "matched" && 
               selectedStudent.partnerData && 
               selectedStudent.cometaData &&
               tenantIntegrationId && (
                <div className={`p-4 rounded-lg border ${
                  referenceStatus?.exists 
                    ? "bg-success-50 border-success-200" 
                    : "bg-gradient-to-r from-galaxy-50 to-aurora-50 border-galaxy-200"
                }`}>
                  {/* Estado de verificación */}
                  {isCheckingReference ? (
                    <div className="flex items-center gap-2 text-neutral-600">
                      <Spinner className="h-4 w-4" />
                      <span className="text-sm">Verificando referencia...</span>
                    </div>
                  ) : referenceStatus?.exists ? (
                    // Ya tiene referencia
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center h-10 w-10 rounded-full bg-success-100">
                        <Link className="h-5 w-5 text-success-600" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-semibold text-success-800 text-sm flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          Referencia Ya Existe
                        </h4>
                        <p className="text-xs text-success-700">
                          Este {dataType === "students" ? "estudiante" : "tutor"} ya está vinculado entre PowerSchool y Cometa
                        </p>
                        {referenceStatus.reference?.created_at && (
                          <p className="text-xs text-success-600 mt-1">
                            Creada: {new Date(referenceStatus.reference.created_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    // No tiene referencia - mostrar botón para crear
                    <>
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1">
                          <h4 className="font-semibold text-neutral-900 text-sm mb-1 flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-warning-500" />
                            Sin Referencia
                          </h4>
                          <p className="text-xs text-neutral-600">
                            Vincula este {dataType === "students" ? "estudiante" : "tutor"} de PowerSchool ({selectedStudent.partnerData?.id || selectedStudent.partnerData?.student_id}) 
                            con Cometa ({selectedStudent.cometaData?.id || selectedStudent.cometaData?.student_id})
                          </p>
                        </div>
                        <Button
                          onClick={() => handleCreateReference(selectedStudent)}
                          disabled={isCreatingReference}
                          className="bg-galaxy-600 hover:bg-galaxy-700 text-white min-w-[150px]"
                        >
                          {isCreatingReference ? (
                            <>
                              <Spinner className="h-4 w-4 mr-2" />
                              Creando...
                            </>
                          ) : (
                            <>
                              <Link className="h-4 w-4 mr-2" />
                              Crear Referencia
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Resultado de la creación de referencia */}
                      {referenceResult && (
                        <div className={`mt-3 p-3 rounded-lg ${
                          referenceResult.success 
                            ? "bg-success-50 border border-success-200" 
                            : "bg-error-50 border border-error-200"
                        }`}>
                          <div className="flex items-center gap-2">
                            {referenceResult.success ? (
                              <CheckCircle2 className="h-5 w-5 text-success-600" />
                            ) : (
                              <XCircle className="h-5 w-5 text-error-600" />
                            )}
                            <p className={`text-sm font-medium ${
                              referenceResult.success ? "text-success-700" : "text-error-700"
                            }`}>
                              {referenceResult.message}
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {(() => {
                const discrepancies = dataType === "guardians"
                  ? compareGuardianData(selectedStudent.partnerData, selectedStudent.cometaData)
                  : compareStudentData(selectedStudent.partnerData, selectedStudent.cometaData)
                const hasDiscrepancies = Object.keys(discrepancies).length > 0

                // Comparar tutores asignados si es estudiante
                const guardianComparison = dataType === "students" 
                  ? compareStudentGuardians(selectedStudent.partnerData, selectedStudent.cometaData)
                  : { hasDiscrepancy: false, details: null }

                if (hasDiscrepancies || guardianComparison.hasDiscrepancy) {
                  return (
                    <div className="space-y-4">
                      {/* Discrepancias de campos */}
                      {hasDiscrepancies && (
                        <Card className="border-warning-200 bg-warning-50/30">
                          <CardHeader className="pb-4 border-b border-warning-100">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="h-5 w-5 text-warning-600" />
                              <CardTitle className="text-lg font-lota text-warning-900">
                                {dataType === "guardians" 
                                  ? "Discrepancias en Datos del Tutor"
                                  : "Discrepancias en Datos del Estudiante"}
                              </CardTitle>
                            </div>
                            <CardDescription className="text-warning-700">
                              Los siguientes campos tienen valores diferentes entre PowerSchool y Cometa
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="pt-4">
                            <div className="space-y-4">
                              {Object.entries(discrepancies).map(([field, values]) => (
                                <div key={field} className="p-3 bg-white rounded-lg border border-warning-200">
                                  <p className="text-sm font-semibold text-warning-900 mb-2">{field}</p>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <p className="text-xs text-galaxy-600 font-medium mb-1">PowerSchool</p>
                                      <p className="text-sm text-neutral-900 font-mono bg-galaxy-50 px-2 py-1 rounded">
                                        {values.partner}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-aurora-600 font-medium mb-1">Cometa</p>
                                      <p className="text-sm text-neutral-900 font-mono bg-aurora-50 px-2 py-1 rounded">
                                        {values.cometa}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Discrepancias en tutores asignados */}
                      {guardianComparison.hasDiscrepancy && guardianComparison.details && (
                        <Card className="border-orange-200 bg-orange-50/30">
                          <CardHeader className="pb-4 border-b border-orange-100">
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="h-5 w-5 text-orange-600" />
                              <CardTitle className="text-lg font-lota text-orange-900">
                                Discrepancias en Tutores Asignados
                              </CardTitle>
                            </div>
                            <CardDescription className="text-orange-700">
                              Los tutores asignados a este estudiante no coinciden entre sistemas
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="pt-4">
                            <div className="space-y-4">
                              <div className="p-3 bg-white rounded-lg border border-orange-200">
                                <p className="text-sm font-semibold text-orange-900 mb-3">Cantidad de Tutores</p>
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <p className="text-xs text-galaxy-600 font-medium mb-1">PowerSchool</p>
                                    <p className="text-2xl font-bold text-galaxy-700 bg-galaxy-50 px-3 py-2 rounded text-center">
                                      {guardianComparison.details.partnerCount}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-aurora-600 font-medium mb-1">Cometa</p>
                                    <p className="text-2xl font-bold text-aurora-700 bg-aurora-50 px-3 py-2 rounded text-center">
                                      {guardianComparison.details.cometaCount}
                                    </p>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="p-3 bg-white rounded-lg border border-orange-200">
                                <p className="text-sm font-semibold text-orange-900 mb-3">Nombres de Tutores</p>
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <p className="text-xs text-galaxy-600 font-medium mb-1">PowerSchool</p>
                                    <p className="text-sm text-neutral-900 bg-galaxy-50 px-2 py-2 rounded whitespace-pre-line">
                                      {guardianComparison.details.partnerNames}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-aurora-600 font-medium mb-1">Cometa</p>
                                    <p className="text-sm text-neutral-900 bg-aurora-50 px-2 py-2 rounded whitespace-pre-line">
                                      {guardianComparison.details.cometaNames}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )
                }
                return null
              })()}

              {dataType === "guardians" && (selectedStudent.partnerData || selectedStudent.cometaData) && (
                (() => {
                  // Obtener arrays de estudiantes (compatible con estructura antigua y nueva)
                  const psStudents = selectedStudent.partnerData?.students || 
                    (selectedStudent.partnerData?.student_id ? [{
                      student_id: selectedStudent.partnerData.student_id,
                      student_name: selectedStudent.partnerData.student_name,
                      student_local_id: selectedStudent.partnerData.student_local_id
                    }] : [])
                  
                  const cmStudents = selectedStudent.cometaData?.students || 
                    (selectedStudent.cometaData?.student_id ? [{
                      student_id: selectedStudent.cometaData.student_id,
                      student_name: selectedStudent.cometaData.student_name,
                      student_identifier: selectedStudent.cometaData.student_identifier
                    }] : [])
                  
                  // Normalizar nombres para comparación
                  const normalizeForComparison = (name: string) => {
                    return name
                      .normalize("NFD")
                      .replace(/[\u0300-\u036f]/g, "") // Quitar acentos
                      .toLowerCase()
                      .replace(/\s+/g, " ")
                      .trim()
                  }

                  // Comparación fuzzy de nombres (maneja casos donde falta apellido materno o segundo nombre)
                  const namesFuzzyMatch = (name1: string, name2: string): boolean => {
                    if (!name1 || !name2) return false
                    if (name1 === name2) return true
                    
                    // Si uno es substring del otro (ej: "Leonardo Alvarado" está en "Leonardo Ivan Alvarado Ayala")
                    if (name1.length > 5 && name2.length > 5) {
                      if (name1.includes(name2) || name2.includes(name1)) return true
                    }
                    
                    // Comparar por palabras
                    const words1 = name1.split(" ").filter(w => w.length >= 2)
                    const words2 = name2.split(" ").filter(w => w.length >= 2)
                    
                    // Si comparten al menos 2 palabras de 3+ caracteres
                    const commonWords = words1.filter(w => w.length >= 3 && words2.includes(w))
                    if (commonWords.length >= 2) return true
                    
                    return false
                  }
                  
                  // Extraer apellidos (últimas 2 palabras)
                  const extractLastNames = (fullName: string) => {
                    const parts = fullName.split(" ").filter(p => p.length > 0)
                    if (parts.length >= 2) {
                      return parts.slice(-2).join(" ")
                    }
                    return ""
                  }

                  // Preparar datos unificados para comparación
                  const allStudentsMap = new Map<string, { 
                    name: string, 
                    normalizedName: string,
                    psData?: any, 
                    cmData?: any 
                  }>()

                  // Procesar PowerSchool
                  psStudents.forEach((student: any) => {
                    const name = student.student_name || "-"
                    const normalized = normalizeForComparison(name)
                    // Usar ID o nombre normalizado como clave
                    const key = student.student_id || normalized
                    
                    if (!allStudentsMap.has(key)) {
                      allStudentsMap.set(key, { name, normalizedName: normalized, psData: student })
                    } else {
                      const entry = allStudentsMap.get(key)!
                      entry.psData = student
                    }
                  })

                  // Procesar Cometa y buscar matches
                  cmStudents.forEach((student: any) => {
                    const name = student.student_name || "-"
                    const normalized = normalizeForComparison(name)
                    
                    // Intentar encontrar match por nombre (fuzzy para manejar apellido materno faltante)
                    let foundKey: string | undefined
                    for (const [key, entry] of allStudentsMap.entries()) {
                      // Usar comparación fuzzy en lugar de exacta
                      if (namesFuzzyMatch(entry.normalizedName, normalized) && !entry.cmData) {
                        foundKey = key
                        break
                      }
                    }

                    if (foundKey) {
                      const entry = allStudentsMap.get(foundKey)!
                      entry.cmData = student
                    } else {
                      // Si no hay match, crear nueva entrada
                      const key = `cm_${student.student_id || normalized}`
                      allStudentsMap.set(key, { name, normalizedName: normalized, cmData: student })
                    }
                  })

                  const allStudents = Array.from(allStudentsMap.values())
                  
                  // Clasificar estudiantes
                  const matchedStudents = allStudents.filter(s => s.psData && s.cmData)
                  const onlyPsStudents = allStudents.filter(s => s.psData && !s.cmData)
                  const onlyCmStudents = allStudents.filter(s => !s.psData && s.cmData)

                  // Extraer TODAS las palabras de los nombres (para detectar apellidos en común)
                  const psAllWords = psStudents.flatMap((s: any) => 
                    normalizeForComparison(s.student_name || "")
                      .split(" ")
                      .filter((w: string) => w.length >= 3) // Solo palabras de 3+ caracteres
                  )
                  
                  const cmAllWords = cmStudents.flatMap((s: any) => 
                    normalizeForComparison(s.student_name || "")
                      .split(" ")
                      .filter((w: string) => w.length >= 3)
                  )

                  // Verificar si hay palabras/apellidos en común (al menos 1 palabra de 4+ chars)
                  const hasCommonLastNames = psAllWords.some((psWord: string) => 
                    psWord.length >= 4 && cmAllWords.includes(psWord)
                  )

                  // Si hay estudiantes que coinciden, considerarlos de la misma familia
                  const hasMatchedStudents = matchedStudents.length > 0

                  // Determinar el tipo de relación
                  const mismatch = !hasCommonLastNames && !hasMatchedStudents && psAllWords.length > 0 && cmAllWords.length > 0
                  const sameFamily = hasCommonLastNames || hasMatchedStudents
                  
                  return (
                    <Card className={`${mismatch ? "border-red-200 bg-red-50/30" : sameFamily ? "border-green-200 bg-green-50/30" : "border-blue-200 bg-blue-50/30"}`}>
                      <CardHeader className="pb-4 border-b border-blue-100">
                        <div className="flex items-center gap-2">
                          {mismatch ? (
                            <AlertTriangle className="h-5 w-5 text-red-600" />
                          ) : sameFamily ? (
                            <AlertCircle className="h-5 w-5 text-green-600" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-blue-600" />
                          )}
                          <CardTitle className={`text-lg font-lota ${mismatch ? "text-red-900" : sameFamily ? "text-green-900" : "text-blue-900"}`}>
                            Estudiantes Asociados ({allStudents.length} total)
                          </CardTitle>
                        </div>
                        <CardDescription className={mismatch ? "text-red-700" : sameFamily ? "text-green-700" : "text-blue-700"}>
                          {mismatch 
                            ? "⚠️ Este tutor está asignado a estudiantes SIN apellidos en común"
                            : sameFamily
                              ? "✅ Mismo tutor para estudiantes de la misma familia (apellidos coinciden)"
                              : "Información de los estudiantes asociados a este tutor"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-4 space-y-4">
                        
                        {/* Alerta de estudiantes que faltan en PowerSchool */}
                        {onlyCmStudents.length > 0 && (
                          <div className="p-4 bg-red-50 border-2 border-red-300 rounded-lg">
                            <div className="flex items-center gap-2 mb-3">
                              <AlertTriangle className="h-5 w-5 text-red-600" />
                              <p className="text-sm font-bold text-red-800">
                                ⚠️ {onlyCmStudents.length} relación{onlyCmStudents.length !== 1 ? "es" : ""} tutor-estudiante en Cometa NO existe{onlyCmStudents.length !== 1 ? "n" : ""} en PowerSchool:
                              </p>
                            </div>
                            <div className="space-y-2">
                              {onlyCmStudents.map((student, idx) => {
                                const cmId = student.cmData?.student_id || null
                                const cmIdentifier = student.cmData?.student_identifier || null
                                return (
                                  <div key={idx} className="p-3 bg-white rounded border border-red-200">
                                    <p className="font-semibold text-neutral-900">{student.name}</p>
                                    <div className="flex gap-4 mt-1 text-xs text-neutral-600 font-mono">
                                      <span>Cometa ID: {cmId ? String(cmId).substring(0, 12) + "..." : "-"}</span>
                                      {cmIdentifier && cmIdentifier !== "-" && (
                                        <span>CURP: {cmIdentifier}</span>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Resumen de coincidencias */}
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                            <p className="text-2xl font-bold text-green-700">{matchedStudents.length}</p>
                            <p className="text-xs text-green-600">Coinciden</p>
                          </div>
                          <div className="p-3 bg-galaxy-50 rounded-lg border border-galaxy-200">
                            <p className="text-2xl font-bold text-galaxy-700">{onlyPsStudents.length}</p>
                            <p className="text-xs text-galaxy-600">Solo PowerSchool</p>
                          </div>
                          <div className="p-3 bg-red-50 rounded-lg border border-red-300">
                            <p className="text-2xl font-bold text-red-700">{onlyCmStudents.length}</p>
                            <p className="text-xs text-red-600">Solo Cometa (faltan en PS)</p>
                          </div>
                        </div>

                        {/* Tabla comparativa de estudiantes */}
                        <details className="group">
                          <summary className="cursor-pointer p-3 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors flex items-center justify-between">
                            <span className="text-sm font-medium text-neutral-700">Ver tabla completa de todos los estudiantes ({allStudents.length})</span>
                            <ChevronRight className="h-4 w-4 text-neutral-500 group-open:rotate-90 transition-transform" />
                          </summary>
                          <div className="mt-3 border border-neutral-200 rounded-lg overflow-hidden bg-white">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-neutral-50 hover:bg-neutral-50">
                                  <TableHead className="w-[40%]">Estudiante</TableHead>
                                  <TableHead className="w-[30%] text-center">PowerSchool</TableHead>
                                  <TableHead className="w-[30%] text-center">Cometa</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {allStudents.map((student, idx) => {
                                  const isMatched = student.psData && student.cmData
                                  const isOnlyPs = student.psData && !student.cmData
                                  const isOnlyCm = !student.psData && student.cmData
                                  
                                  // Obtener IDs para mostrar
                                  const psId = student.psData?.student_id || student.psData?.student_local_id || null
                                  const cmId = student.cmData?.student_id || null
                                  const cmIdentifier = student.cmData?.student_identifier || null
                                  
                                  return (
                                    <TableRow key={idx} className={isMatched ? "bg-green-50/30" : isOnlyPs ? "bg-galaxy-50/30" : "bg-red-50/50"}>
                                      <TableCell className="font-medium">
                                        <div className="flex flex-col">
                                          <span>{student.name}</span>
                                          {isMatched && <span className="text-xs text-green-600 font-normal">✅ Coincide en ambos</span>}
                                          {isOnlyPs && <span className="text-xs text-warning-600 font-normal">⚠️ Solo en PowerSchool</span>}
                                          {isOnlyCm && <span className="text-xs text-red-600 font-normal">❌ FALTA en PowerSchool</span>}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-center">
                                        {student.psData ? (
                                          <div className="flex flex-col items-center">
                                            <Badge variant="outline" className="bg-galaxy-50 text-galaxy-700 border-galaxy-200 mb-1">
                                              ✅ Presente
                                            </Badge>
                                            <span className="text-xs text-neutral-600 font-mono">ID: {psId}</span>
                                            {student.psData.student_local_id && student.psData.student_local_id !== "-" && (
                                              <span className="text-xs text-neutral-500 font-mono">Mat: {student.psData.student_local_id}</span>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="flex flex-col items-center">
                                            <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 mb-1">
                                              ❌ Sin relación
                                            </Badge>
                                            {cmId && (
                                              <span className="text-xs text-neutral-400 font-mono">
                                                (Cometa ID: {String(cmId).substring(0, 8)}...)
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        {student.cmData ? (
                                          <div className="flex flex-col items-center">
                                            <Badge variant="outline" className="bg-aurora-50 text-aurora-700 border-aurora-200 mb-1">
                                              ✅ Presente
                                            </Badge>
                                            <span className="text-xs text-neutral-600 font-mono">ID: {String(cmId).substring(0, 8)}...</span>
                                            {cmIdentifier && cmIdentifier !== "-" && (
                                              <span className="text-xs text-neutral-500 font-mono">CURP: {cmIdentifier}</span>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="flex flex-col items-center">
                                            <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 mb-1">
                                              ❌ Sin relación
                                            </Badge>
                                            {psId && (
                                              <span className="text-xs text-neutral-400 font-mono">
                                                (PS ID: {psId})
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </details>

                        {mismatch && (
                          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                            <p className="text-xs text-red-700">
                              <strong>⚠️ Advertencia:</strong> Los apellidos no coinciden entre sistemas. Este tutor podría estar asociado a familias diferentes.
                            </p>
                          </div>
                        )}
                        {sameFamily && (
                          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                            <p className="text-xs text-green-800">
                              <strong>✅ Verificación:</strong> Los estudiantes coinciden o comparten apellidos. 
                              Es normal que hermanos o el mismo estudiante tengan el mismo tutor. No hay conflicto.
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )
                })()
              )}

              <div className="grid md:grid-cols-2 gap-6">
                <Card className="border-galaxy-200 bg-galaxy-50/30">
                  <CardHeader className="pb-4 border-b border-galaxy-100">
                    <CardTitle className="text-xl font-lota text-galaxy-900">PowerSchool</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    {selectedStudent.partnerData ? (
                      <div className="space-y-3">
                        {Object.entries(
                          dataType === "guardians"
                            ? getRelevantPartnerGuardianFields(selectedStudent.partnerData)
                            : getRelevantPartnerFields(selectedStudent.partnerData, selectedStudent.cometaData),
                        ).map(([key, value]) => (
                          <div
                            key={key}
                            className="flex flex-col sm:flex-row sm:justify-between gap-2 py-3 border-b border-galaxy-100 last:border-0"
                          >
                            <span className="text-sm font-semibold text-galaxy-700 min-w-[180px]">{key}</span>
                            <span className="text-sm text-neutral-900 sm:text-right break-words">
                              {value !== null && value !== undefined ? String(value) : "-"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-neutral-500 italic py-8 text-center">No hay datos de PowerSchool</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-aurora-200 bg-aurora-50/30">
                  <CardHeader className="pb-4 border-b border-aurora-100">
                    <CardTitle className="text-xl font-lota text-aurora-900">Cometa (Schools)</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    {selectedStudent.cometaData ? (
                      <div className="space-y-3">
                        {Object.entries(
                          dataType === "guardians"
                            ? getRelevantCometaGuardianFields(selectedStudent.cometaData)
                            : getRelevantCometaFields(selectedStudent.cometaData),
                        ).map(([key, value]) => (
                          <div
                            key={key}
                            className="flex flex-col sm:flex-row sm:justify-between gap-2 py-3 border-b border-aurora-100 last:border-0"
                          >
                            <span className="text-sm font-semibold text-aurora-700 min-w-[180px]">{key}</span>
                            <span className="text-sm text-neutral-900 sm:text-right break-words">
                              {value !== null && value !== undefined ? String(value) : "-"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-neutral-500 italic py-8 text-center">No hay datos de Cometa</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
