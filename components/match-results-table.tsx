"use client"

import { useState, useMemo } from "react"
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

interface MatchResultsTableProps {
  results: MatchedStudent[]
  dataType?: "students" | "guardians"
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
    Nombre: data.first_name && data.last_name ? `${data.first_name} ${data.last_name}` : "-",
    Matrícula: data.enrollment_code || "-",
    CURP: data.identifier || "-",
    "Fecha de Nacimiento": birthdate,
    Género: data.gender || "-",
    "Grado y Grupo": section,
    Estado: data.state || "-",
    Eliminado: data.deleted_at ? `Sí (${data.deleted_at})` : "No",
  }
}

const getRelevantPartnerFields = (data: any) => {
  if (!data) return {}

  // Buscar el grado en múltiples campos posibles
  const grade = data.grade_level || data.grade || data.gradelevel || data.current_grade || "-"
  const dob = data.dob || data.birthdate
  const birthdate = dob ? normalizeDateForComparison(dob) : "-"

  return {
    Nombre: data.first_name && data.last_name ? `${data.first_name} ${data.last_name}` : "-",
    "Matrícula (Local ID)": data.local_id || "-",
    "Student Number": data.student_number || "-",
    CURP: data.curp || data.state_studentnumber || "-",
    "Fecha de Nacimiento": birthdate,
    Género: data.gender || "-",
    Grado: grade,
  }
}

const getRelevantPartnerGuardianFields = (data: any) => {
  if (!data) return {}

  return {
    Nombre:
      data.firstName && data.lastName
        ? `${data.firstName} ${data.lastName}`
        : data.first_name && data.last_name
          ? `${data.first_name} ${data.last_name}`
          : "-",
    Email: data.emails || data.email || "-",
    Teléfono: data.phones || data.phone || "-",
    "ID Guardian": data.id || data.guardian_id || "-",
    "ID Estudiante Asociado (PowerSchool)": data.student_id || "-",
    "School ID": data.school_id || "-",
  }
}

const getRelevantCometaGuardianFields = (data: any) => {
  if (!data) return {}

  return {
    Nombre: data.first_name && data.last_name ? `${data.first_name} ${data.last_name}` : "-",
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

const compareStudentData = (partnerData: any, cometaData: any) => {
  if (!partnerData || !cometaData) return {}

  const discrepancies: Record<string, { partner: string; cometa: string }> = {}

  // Comparar nombres
  const partnerName = `${partnerData.first_name || ""} ${partnerData.last_name || ""}`.trim().toLowerCase()
  const cometaName = `${cometaData.first_name || ""} ${cometaData.last_name || ""}`.trim().toLowerCase()
  if (partnerName && cometaName && partnerName !== cometaName) {
    discrepancies.Nombre = {
      partner: `${partnerData.first_name || ""} ${partnerData.last_name || ""}`.trim(),
      cometa: `${cometaData.first_name || ""} ${cometaData.last_name || ""}`.trim(),
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

  // Comparar grado
  const partnerGrade = String(
    partnerData.grade_level || partnerData.grade || partnerData.gradelevel || partnerData.current_grade || "",
  )
  const cometaSection = cometaData.section
  let cometaGrade = ""
  if (cometaSection) {
    if (typeof cometaSection === "string") {
      try {
        const parsed = JSON.parse(cometaSection)
        cometaGrade = String(parsed.grade || "")
      } catch {
        // Ignore parse errors
      }
    } else if (typeof cometaSection === "object") {
      cometaGrade = String(cometaSection.grade || "")
    }
  }
  if (partnerGrade && cometaGrade && partnerGrade !== cometaGrade) {
    discrepancies.Grado = {
      partner: partnerGrade,
      cometa: cometaGrade,
    }
  }

  return discrepancies
}

const compareGuardianData = (partnerData: any, cometaData: any) => {
  if (!partnerData || !cometaData) return {}

  const discrepancies: Record<string, { partner: string; cometa: string }> = {}

  // Comparar nombres
  const partnerFirstName = (partnerData.firstName || partnerData.first_name || "").trim().toLowerCase()
  const partnerLastName = (partnerData.lastName || partnerData.last_name || "").trim().toLowerCase()
  const partnerName = `${partnerFirstName} ${partnerLastName}`.trim()

  const cometaFirstName = (cometaData.first_name || cometaData.nombre || "").trim().toLowerCase()
  const cometaLastName = (cometaData.last_name || cometaData.apellido || "").trim().toLowerCase()
  const cometaName = `${cometaFirstName} ${cometaLastName}`.trim()

  if (partnerName && cometaName && partnerName !== cometaName) {
    discrepancies.Nombre = {
      partner: `${partnerData.firstName || partnerData.first_name || ""} ${partnerData.lastName || partnerData.last_name || ""}`.trim(),
      cometa: `${cometaData.first_name || cometaData.nombre || ""} ${cometaData.last_name || cometaData.apellido || ""}`.trim(),
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

  // 2. Verificar nombres exactos (sets iguales)
  const areEqual = JSON.stringify(partnerNames) === JSON.stringify(cometaNames)
  
  if (!areEqual) {
     const inPSnotCometa = partnerNames.filter((n: string) => !cometaNames.includes(n))
     const inCometaNotPS = cometaNames.filter((n: string) => !partnerNames.includes(n))
     
     let details = []
     if (inPSnotCometa.length > 0) details.push(`Solo en PS: ${inPSnotCometa.slice(0, 2).join(", ")}${inPSnotCometa.length > 2 ? "..." : ""}`)
     if (inCometaNotPS.length > 0) details.push(`Solo en Cometa: ${inCometaNotPS.slice(0, 2).join(", ")}${inCometaNotPS.length > 2 ? "..." : ""}`)
     
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

export function MatchResultsTable({ results, dataType = "students" }: MatchResultsTableProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedStudent, setSelectedStudent] = useState<MatchedStudent | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

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

    return filtered
  }, [resultsWithDiscrepancies, searchTerm, statusFilter])

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
                <div className="flex gap-2">
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
                  <Button
                    onClick={handleDownloadExcel}
                    variant="outline"
                    size="sm"
                    className="border-galaxy-300 hover:bg-galaxy-50 text-galaxy-700"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Descargar Excel
                  </Button>
                </div>
              )}
            </div>
          </div>

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
                          ? `${result.partnerData.first_name} ${result.partnerData.last_name}`
                          : result.partnerData?.firstName && result.partnerData?.lastName
                            ? `${result.partnerData.firstName} ${result.partnerData.lastName}`
                            : result.partnerData?.nombre || "-"
                      const cometaName =
                        result.cometaData?.first_name && result.cometaData?.last_name
                          ? `${result.cometaData.first_name} ${result.cometaData.last_name}`
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
                    
                    // Intentar encontrar match por nombre normalizado
                    let foundKey: string | undefined
                    for (const [key, entry] of allStudentsMap.entries()) {
                      if (entry.normalizedName === normalized && !entry.cmData) {
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

                  // Extraer apellidos de todos los estudiantes para verificación de familia
                  const psLastNamesList = psStudents.map((s: any) => 
                    normalizeForComparison(extractLastNames(s.student_name || ""))
                  ).filter(Boolean)
                  
                  const cmLastNamesList = cmStudents.map((s: any) => 
                    normalizeForComparison(extractLastNames(s.student_name || ""))
                  ).filter(Boolean)

                  // Verificar si hay apellidos en común
                  const hasCommonLastNames = psLastNamesList.some(psLN => 
                    cmLastNamesList.some(cmLN => psLN === cmLN)
                  )

                  // Determinar el tipo de relación
                  const mismatch = !hasCommonLastNames && psLastNamesList.length > 0 && cmLastNamesList.length > 0
                  const sameFamily = hasCommonLastNames
                  
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
                                ⚠️ {onlyCmStudents.length} estudiante{onlyCmStudents.length !== 1 ? "s" : ""} en Cometa NO existe{onlyCmStudents.length !== 1 ? "n" : ""} en PowerSchool:
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
                                              ❌ No existe
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
                                              ❌ No existe
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
                              <strong>✅ Verificación:</strong> Los apellidos coinciden ({[...new Set(psLastNamesList.concat(cmLastNamesList))].join(", ")}). 
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
                            : getRelevantPartnerFields(selectedStudent.partnerData),
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
