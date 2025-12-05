"use client"

import { useState, useMemo } from "react"
import * as XLSX from "xlsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Download,
  Search,
  Users,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileSpreadsheet,
} from "lucide-react"
import type { GuardianComparisonResult } from "@/app/actions/credentials"

interface GuardiansComparisonProps {
  results: GuardianComparisonResult[]
  isLoading: boolean
  progress: { current: number; total: number; studentName: string } | null
  onBack: () => void
}

const ITEMS_PER_PAGE = 15

export function GuardiansComparison({ results, isLoading, progress, onBack }: GuardiansComparisonProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [filterType, setFilterType] = useState<"all" | "with_discrepancies" | "missing_in_cometa" | "missing_in_ps" | "data_diff">("all")
  const [selectedStudent, setSelectedStudent] = useState<GuardianComparisonResult | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Estadísticas
  const stats = useMemo(() => {
    const withDiscrepancies = results.filter((r) => r.hasDiscrepancies)
    const missingInCometa = results.filter((r) => r.discrepancies.onlyInPowerschool.length > 0)
    const missingInPs = results.filter((r) => r.discrepancies.onlyInCometa.length > 0)
    const withDataDiff = results.filter((r) => r.discrepancies.dataDifferences.length > 0)
    const noIssues = results.filter((r) => !r.hasDiscrepancies)

    return {
      total: results.length,
      withDiscrepancies: withDiscrepancies.length,
      missingInCometa: missingInCometa.length,
      missingInPs: missingInPs.length,
      withDataDiff: withDataDiff.length,
      noIssues: noIssues.length,
    }
  }, [results])

  // Filtrar resultados
  const filteredResults = useMemo(() => {
    let filtered = results

    switch (filterType) {
      case "with_discrepancies":
        filtered = results.filter((r) => r.hasDiscrepancies)
        break
      case "missing_in_cometa":
        filtered = results.filter((r) => r.discrepancies.onlyInPowerschool.length > 0)
        break
      case "missing_in_ps":
        filtered = results.filter((r) => r.discrepancies.onlyInCometa.length > 0)
        break
      case "data_diff":
        filtered = results.filter((r) => r.discrepancies.dataDifferences.length > 0)
        break
    }

    if (searchTerm) {
      filtered = filtered.filter(
        (r) =>
          r.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          r.studentLocalId.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    return filtered
  }, [results, filterType, searchTerm])

  // Paginación
  const totalPages = Math.ceil(filteredResults.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const currentResults = filteredResults.slice(startIndex, endIndex)

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setCurrentPage(1)
  }

  const handleFilterChange = (type: typeof filterType) => {
    setFilterType(type)
    setCurrentPage(1)
  }

  const handleRowClick = (result: GuardianComparisonResult) => {
    setSelectedStudent(result)
    setIsModalOpen(true)
  }

  // Generar Excel para el colegio - Tutores en Cometa que NO están en PowerSchool
  // PowerSchool = Fuente de verdad. Cometa tiene datos extra que deben revisarse.
  const handleDownloadExcel = () => {
    // Filtrar estudiantes que tienen tutores en Cometa que no están en PowerSchool
    const studentsWithExtraGuardians = results.filter(
      (r) => r.discrepancies.onlyInCometa.length > 0
    )

    if (studentsWithExtraGuardians.length === 0) {
      alert("✅ ¡Excelente! Todos los tutores en Cometa también existen en PowerSchool. No hay discrepancias.")
      return
    }

    // Crear datos para el Excel - UNA FILA POR ESTUDIANTE
    const excelData: any[] = []
    
    studentsWithExtraGuardians.forEach((r) => {
      // Formatear tutores de PowerSchool (fuente de verdad)
      const tutoresPowerSchool = r.powerschoolGuardians.map((g) => {
        const nombre = `${g.firstName || g.first_name || ""} ${g.lastName || g.last_name || ""}`.trim()
        const telefono = g.phones || g.phone || ""
        return `${nombre}${telefono ? ` (${telefono})` : ""}`
      }).join(" | ") || "Sin tutores en PowerSchool"

      // Formatear TODOS los tutores extra en Cometa en una sola celda
      const tutoresExtraCometa = r.discrepancies.onlyInCometa.map((guardian) => {
        const nombre = `${guardian.first_name || guardian.nombre || ""} ${guardian.last_name || guardian.apellido || ""}`.trim()
        const telefono = guardian.phone || guardian.phone_number || ""
        const email = guardian.email || ""
        return `${nombre}${telefono ? ` | Tel: ${telefono}` : ""}${email ? ` | Email: ${email}` : ""}`
      }).join("\n")

      excelData.push({
        "Matrícula": r.studentLocalId,
        "Estudiante": r.studentName,
        "# Tutores PowerSchool": r.powerschoolGuardians.length,
        "# Tutores Cometa": r.cometaGuardians.length,
        "Diferencia": r.cometaGuardians.length - r.powerschoolGuardians.length,
        "Tutores en PowerSchool (Fuente de Verdad)": tutoresPowerSchool,
        "⚠️ TUTORES EXTRA EN COMETA (No están en PowerSchool)": tutoresExtraCometa,
        "Cantidad de Tutores Extra": r.discrepancies.onlyInCometa.length,
      })
    })

    // Crear workbook
    const workbook = XLSX.utils.book_new()

    // Hoja principal con los datos
    const sheet = XLSX.utils.json_to_sheet(excelData)
    sheet["!cols"] = [
      { wch: 12 },  // Matrícula
      { wch: 30 },  // Estudiante
      { wch: 12 },  // # Tutores PS
      { wch: 12 },  // # Tutores Cometa
      { wch: 10 },  // Diferencia
      { wch: 60 },  // Tutores en PowerSchool
      { wch: 70 },  // Tutores Extra
      { wch: 12 },  // Cantidad Extra
    ]
    XLSX.utils.book_append_sheet(workbook, sheet, "Estudiantes a Revisar")

    // Contar total de tutores extra
    const totalTutoresExtra = studentsWithExtraGuardians.reduce(
      (sum, r) => sum + r.discrepancies.onlyInCometa.length, 0
    )

    // Hoja de resumen con explicación detallada
    const resumenData = [
      { "": "═══════════════════════════════════════════════════════════════" },
      { "": "REPORTE DE RELACIONES TUTOR-ESTUDIANTE" },
      { "": "Comparación entre PowerSchool y Cometa" },
      { "": "═══════════════════════════════════════════════════════════════" },
      { "": "" },
      { "": "RESUMEN DE HALLAZGOS" },
      { "": `• Total de estudiantes analizados: ${results.length}` },
      { "": `• Estudiantes con tutores adicionales en Cometa: ${studentsWithExtraGuardians.length}` },
      { "": `• Total de relaciones tutor-estudiante a revisar: ${totalTutoresExtra}` },
      { "": "" },
      { "": "───────────────────────────────────────────────────────────────" },
      { "": "¿QUÉ SIGNIFICA ESTE REPORTE?" },
      { "": "───────────────────────────────────────────────────────────────" },
      { "": "" },
      { "": "Este reporte muestra estudiantes que tienen más tutores asociados en Cometa" },
      { "": "que en PowerSchool." },
      { "": "" },
      { "": "Esto significa que existen relaciones tutor-estudiante registradas en Cometa" },
      { "": "que NO están configuradas en PowerSchool." },
      { "": "" },
      { "": "───────────────────────────────────────────────────────────────" },
      { "": "COLUMNAS DEL ARCHIVO" },
      { "": "───────────────────────────────────────────────────────────────" },
      { "": "" },
      { "": "• Matrícula: Identificador del estudiante" },
      { "": "• Estudiante: Nombre completo del estudiante" },
      { "": "• # Tutores PowerSchool: Cantidad de tutores vinculados en PS" },
      { "": "• # Tutores Cometa: Cantidad de tutores vinculados en Cometa" },
      { "": "• Diferencia: Cuántos tutores de más tiene en Cometa" },
      { "": "• Tutores en PowerSchool: Lista de tutores actuales (fuente de verdad)" },
      { "": "• ⚠️ TUTORES EXTRA EN COMETA: Tutores que están en Cometa pero NO en PowerSchool" },
      { "": "" },
      { "": "───────────────────────────────────────────────────────────────" },
      { "": "¿CÓMO PROCEDER?" },
      { "": "───────────────────────────────────────────────────────────────" },
      { "": "" },
      { "": "Dado que desde nuestra integración no tenemos permisos de escritura para" },
      { "": "crear relaciones tutor-estudiante en PowerSchool, solicitamos su apoyo para" },
      { "": "revisar estos casos." },
      { "": "" },
      { "": "OPCIONES:" },
      { "": "" },
      { "": "1. Si la relación es correcta → Vincular al estudiante con el tutor" },
      { "": "   directamente en PowerSchool" },
      { "": "" },
      { "": "2. Si la relación en Cometa es incorrecta → Notifíquenos para ajustarla" },
      { "": "   de nuestro lado" },
      { "": "" },
      { "": "───────────────────────────────────────────────────────────────" },
      { "": `Reporte generado: ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}` },
      { "": "───────────────────────────────────────────────────────────────" },
    ]
    const resumenSheet = XLSX.utils.json_to_sheet(resumenData, { skipHeader: true })
    resumenSheet["!cols"] = [{ wch: 80 }]
    XLSX.utils.book_append_sheet(workbook, resumenSheet, "Información")

    // Descargar
    const today = new Date().toISOString().split("T")[0]
    const fileName = `tutores-extra-cometa-${studentsWithExtraGuardians.length}-estudiantes-${today}.xlsx`
    XLSX.writeFile(workbook, fileName)
  }

  // Vista de carga
  if (isLoading && progress) {
    return (
      <Card className="border-galaxy-200 bg-gradient-to-br from-white to-galaxy-50 shadow-lg">
        <CardHeader className="border-b border-galaxy-100">
          <CardTitle className="text-galaxy-900 font-lota text-2xl flex items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-galaxy-500" />
            Comparando Tutores de Estudiantes
          </CardTitle>
          <CardDescription className="text-galaxy-700">
            Obteniendo tutores de PowerSchool y Cometa para cada estudiante emparejado...
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-galaxy-800">
                Procesando: {progress.studentName}
              </span>
              <Badge className="bg-galaxy-100 text-galaxy-700 border-galaxy-300">
                {progress.current} / {progress.total}
              </Badge>
            </div>
            <Progress value={(progress.current / progress.total) * 100} className="h-3" />
            <p className="text-sm text-galaxy-600 text-center">
              {Math.round((progress.current / progress.total) * 100)}% completado
            </p>
          </div>

          <div className="p-4 bg-galaxy-50 rounded-lg border border-galaxy-200">
            <p className="text-sm text-galaxy-700">
              <strong>ℹ️ Información:</strong> Este proceso consulta los tutores de cada estudiante emparejado 
              tanto en PowerSchool como en Cometa para verificar que estén correctamente sincronizados.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Vista de resultados vacíos
  if (results.length === 0 && !isLoading) {
    return (
      <Card className="border-neutral-200 bg-white shadow-lg">
        <CardHeader className="border-b border-neutral-100">
          <CardTitle className="text-neutral-900 font-lota text-2xl">Comparación de Tutores</CardTitle>
        </CardHeader>
        <CardContent className="p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-neutral-100 flex items-center justify-center">
              <Users className="h-8 w-8 text-neutral-400" />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-neutral-700">No hay resultados</p>
              <p className="text-sm text-neutral-500">
                Primero debe ejecutar la comparación de tutores
              </p>
            </div>
            <Button onClick={onBack} variant="outline">
              Volver
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card className="border-neutral-200 bg-gradient-to-br from-white to-neutral-25 shadow-lg w-full">
        <CardHeader className="border-b border-neutral-100 bg-white/80 backdrop-blur-sm">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-neutral-900 font-lota text-2xl font-semibold flex items-center gap-3">
                <Users className="h-7 w-7 text-galaxy-500" />
                Comparación de Tutores por Estudiante
              </CardTitle>
              <CardDescription className="text-neutral-600">
                Verificación de tutores entre PowerSchool y Cometa para cada estudiante emparejado
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                variant="secondary"
                className="bg-galaxy-50 text-galaxy-700 border-galaxy-200 px-3 py-1.5 text-sm font-semibold"
              >
                {filteredResults.length} estudiantes
              </Badge>
              <Button
                onClick={handleDownloadExcel}
                className="bg-success-500 hover:bg-success-600 text-white"
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Descargar Excel
              </Button>
            </div>
          </div>

          {/* Estadísticas */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
            <Card
              className={`border-success-200 bg-success-50 cursor-pointer transition-all hover:shadow-md ${filterType === "all" && stats.noIssues === stats.total ? "ring-2 ring-success-400" : ""}`}
              onClick={() => handleFilterChange("all")}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success-500" />
                  <div>
                    <p className="text-xs text-success-600 font-medium">Total</p>
                    <p className="text-lg font-bold text-success-700">{stats.total}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-warning-200 bg-warning-50 cursor-pointer transition-all hover:shadow-md ${filterType === "with_discrepancies" ? "ring-2 ring-warning-400" : ""}`}
              onClick={() => handleFilterChange("with_discrepancies")}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning-500" />
                  <div>
                    <p className="text-xs text-warning-600 font-medium">Con Discrepancias</p>
                    <p className="text-lg font-bold text-warning-700">{stats.withDiscrepancies}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-red-200 bg-red-50 cursor-pointer transition-all hover:shadow-md ${filterType === "missing_in_cometa" ? "ring-2 ring-red-400" : ""}`}
              onClick={() => handleFilterChange("missing_in_cometa")}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <div>
                    <p className="text-xs text-red-600 font-medium">Faltan en Cometa</p>
                    <p className="text-lg font-bold text-red-700">{stats.missingInCometa}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-purple-200 bg-purple-50 cursor-pointer transition-all hover:shadow-md ${filterType === "missing_in_ps" ? "ring-2 ring-purple-400" : ""}`}
              onClick={() => handleFilterChange("missing_in_ps")}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-purple-500" />
                  <div>
                    <p className="text-xs text-purple-600 font-medium">Solo en Cometa</p>
                    <p className="text-lg font-bold text-purple-700">{stats.missingInPs}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-orange-200 bg-orange-50 cursor-pointer transition-all hover:shadow-md ${filterType === "data_diff" ? "ring-2 ring-orange-400" : ""}`}
              onClick={() => handleFilterChange("data_diff")}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  <div>
                    <p className="text-xs text-orange-600 font-medium">Datos Diferentes</p>
                    <p className="text-lg font-bold text-orange-700">{stats.withDataDiff}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-green-200 bg-green-50 cursor-pointer transition-all hover:shadow-md`}
              onClick={() => handleFilterChange("all")}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <div>
                    <p className="text-xs text-green-600 font-medium">Sin Problemas</p>
                    <p className="text-lg font-bold text-green-700">{stats.noIssues}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Búsqueda */}
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-neutral-400 group-focus-within:text-galaxy-500 transition-colors" />
            <Input
              type="text"
              placeholder="Buscar por nombre o matrícula del estudiante..."
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

          {/* Tabla */}
          <div className="border border-neutral-200 rounded-xl overflow-hidden shadow-sm bg-white">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-neutral-50 to-neutral-25 border-b border-neutral-200 hover:bg-neutral-50">
                    <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                      Estado
                    </TableHead>
                    <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                      Matrícula
                    </TableHead>
                    <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                      Nombre Estudiante
                    </TableHead>
                    <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap text-center">
                      Tutores PS
                    </TableHead>
                    <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap text-center">
                      Tutores Cometa
                    </TableHead>
                    <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap text-center">
                      Emparejados
                    </TableHead>
                    <TableHead className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 whitespace-nowrap">
                      Discrepancias
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
                            <p className="text-sm text-neutral-500">
                              Intenta con otros términos de búsqueda o filtros
                            </p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    currentResults.map((result, index) => (
                      <TableRow
                        key={`${result.studentId}-${index}`}
                        onClick={() => handleRowClick(result)}
                        className="hover:bg-galaxy-50/50 transition-colors border-b border-neutral-100 last:border-0 cursor-pointer"
                      >
                        <TableCell className="py-4 px-6">
                          {result.hasDiscrepancies ? (
                            <Badge
                              variant="secondary"
                              className="bg-warning-50 text-warning-700 border-warning-200 flex items-center gap-1.5 w-fit"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Con Diferencias
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="bg-success-50 text-success-700 border-success-200 flex items-center gap-1.5 w-fit"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              OK
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-neutral-700 py-4 px-6 font-mono text-sm">
                          {result.studentLocalId}
                        </TableCell>
                        <TableCell className="text-neutral-700 py-4 px-6 font-medium text-sm">
                          {result.studentName}
                        </TableCell>
                        <TableCell className="text-neutral-700 py-4 px-6 text-sm text-center">
                          <Badge variant="outline" className="bg-galaxy-50 text-galaxy-700 border-galaxy-200">
                            {result.powerschoolGuardians.length}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-neutral-700 py-4 px-6 text-sm text-center">
                          <Badge variant="outline" className="bg-aurora-50 text-aurora-700 border-aurora-200">
                            {result.cometaGuardians.length}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-neutral-700 py-4 px-6 text-sm text-center">
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            {result.discrepancies.matched.length}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4 px-6">
                          <div className="flex flex-wrap gap-1">
                            {result.discrepancies.onlyInPowerschool.length > 0 && (
                              <Badge variant="secondary" className="bg-red-50 text-red-700 border-red-200 text-xs">
                                {result.discrepancies.onlyInPowerschool.length} faltan en Cometa
                              </Badge>
                            )}
                            {result.discrepancies.onlyInCometa.length > 0 && (
                              <Badge variant="secondary" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">
                                {result.discrepancies.onlyInCometa.length} solo Cometa
                              </Badge>
                            )}
                            {result.discrepancies.dataDifferences.length > 0 && (
                              <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-xs">
                                {result.discrepancies.dataDifferences.length} datos diferentes
                              </Badge>
                            )}
                            {!result.hasDiscrepancies && (
                              <span className="text-sm text-neutral-500">Sin discrepancias</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Paginación */}
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

      {/* Modal de detalles */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-[95vw] lg:max-w-[85vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-lota text-neutral-900">
              Detalles de Tutores - {selectedStudent?.studentName}
            </DialogTitle>
            <DialogDescription className="text-neutral-600">
              Matrícula: {selectedStudent?.studentLocalId} | ID PowerSchool: {selectedStudent?.studentId} | ID Cometa: {selectedStudent?.cometaStudentId || "N/A"}
            </DialogDescription>
          </DialogHeader>

          {selectedStudent && (
            <div className="space-y-6 mt-4">
              {/* Resumen */}
              <div className="grid grid-cols-4 gap-4">
                <div className="p-4 bg-galaxy-50 rounded-lg border border-galaxy-200 text-center">
                  <p className="text-2xl font-bold text-galaxy-700">{selectedStudent.powerschoolGuardians.length}</p>
                  <p className="text-sm text-galaxy-600">Tutores en PowerSchool</p>
                </div>
                <div className="p-4 bg-aurora-50 rounded-lg border border-aurora-200 text-center">
                  <p className="text-2xl font-bold text-aurora-700">{selectedStudent.cometaGuardians.length}</p>
                  <p className="text-sm text-aurora-600">Tutores en Cometa</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg border border-green-200 text-center">
                  <p className="text-2xl font-bold text-green-700">{selectedStudent.discrepancies.matched.length}</p>
                  <p className="text-sm text-green-600">Emparejados</p>
                </div>
                <div className="p-4 bg-warning-50 rounded-lg border border-warning-200 text-center">
                  <p className="text-2xl font-bold text-warning-700">
                    {selectedStudent.discrepancies.onlyInPowerschool.length + 
                     selectedStudent.discrepancies.onlyInCometa.length +
                     selectedStudent.discrepancies.dataDifferences.length}
                  </p>
                  <p className="text-sm text-warning-600">Discrepancias</p>
                </div>
              </div>

              {/* Tutores faltantes en Cometa */}
              {selectedStudent.discrepancies.onlyInPowerschool.length > 0 && (
                <Card className="border-red-200 bg-red-50/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg font-lota text-red-900 flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-red-500" />
                      Tutores que FALTAN en Cometa ({selectedStudent.discrepancies.onlyInPowerschool.length})
                    </CardTitle>
                    <CardDescription className="text-red-700">
                      Estos tutores están en PowerSchool pero NO en Cometa - necesitan sincronizarse
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {selectedStudent.discrepancies.onlyInPowerschool.map((guardian, idx) => (
                        <div key={idx} className="p-3 bg-white rounded-lg border border-red-200">
                          <p className="font-semibold text-neutral-900">
                            {guardian.firstName || guardian.first_name || ""} {guardian.lastName || guardian.last_name || ""}
                          </p>
                          <div className="flex gap-4 mt-1 text-sm text-neutral-600">
                            <span>📧 {guardian.emails || guardian.email || "-"}</span>
                            <span>📱 {guardian.phones || guardian.phone || "-"}</span>
                            <span>👤 {guardian.relationship || guardian.type || "-"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Tutores solo en Cometa */}
              {selectedStudent.discrepancies.onlyInCometa.length > 0 && (
                <Card className="border-purple-200 bg-purple-50/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg font-lota text-purple-900 flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-purple-500" />
                      Tutores SOLO en Cometa ({selectedStudent.discrepancies.onlyInCometa.length})
                    </CardTitle>
                    <CardDescription className="text-purple-700">
                      Estos tutores están en Cometa pero NO en PowerSchool
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {selectedStudent.discrepancies.onlyInCometa.map((guardian, idx) => (
                        <div key={idx} className="p-3 bg-white rounded-lg border border-purple-200">
                          <p className="font-semibold text-neutral-900">
                            {guardian.first_name || guardian.nombre || ""} {guardian.last_name || guardian.apellido || ""}
                          </p>
                          <div className="flex gap-4 mt-1 text-sm text-neutral-600">
                            <span>📧 {guardian.email || "-"}</span>
                            <span>📱 {guardian.phone || guardian.phone_number || "-"}</span>
                            <span>🔑 ID: {guardian.id ? String(guardian.id).substring(0, 12) + "..." : "-"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Diferencias de datos */}
              {selectedStudent.discrepancies.dataDifferences.length > 0 && (
                <Card className="border-orange-200 bg-orange-50/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg font-lota text-orange-900 flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-orange-500" />
                      Diferencias de Datos ({selectedStudent.discrepancies.dataDifferences.length})
                    </CardTitle>
                    <CardDescription className="text-orange-700">
                      Tutores emparejados pero con datos diferentes entre sistemas
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {selectedStudent.discrepancies.dataDifferences.map((diff, idx) => (
                        <div key={idx} className="p-3 bg-white rounded-lg border border-orange-200">
                          <p className="font-semibold text-neutral-900 mb-2">
                            {diff.guardianName} - <span className="text-orange-600">{diff.field}</span>
                          </p>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-xs text-galaxy-600 font-medium mb-1">PowerSchool</p>
                              <p className="text-sm text-neutral-900 font-mono bg-galaxy-50 px-2 py-1 rounded">
                                {diff.powerschoolValue}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-aurora-600 font-medium mb-1">Cometa</p>
                              <p className="text-sm text-neutral-900 font-mono bg-aurora-50 px-2 py-1 rounded">
                                {diff.cometaValue}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Tutores emparejados correctamente */}
              {selectedStudent.discrepancies.matched.length > 0 && (
                <Card className="border-green-200 bg-green-50/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg font-lota text-green-900 flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      Tutores Emparejados Correctamente ({selectedStudent.discrepancies.matched.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {selectedStudent.discrepancies.matched.map((match, idx) => (
                        <div key={idx} className="p-3 bg-white rounded-lg border border-green-200">
                          <p className="font-semibold text-neutral-900">
                            {match.powerschool.firstName || match.powerschool.first_name || ""}{" "}
                            {match.powerschool.lastName || match.powerschool.last_name || ""}
                          </p>
                          <div className="flex gap-4 mt-1 text-sm text-neutral-600">
                            <span>📧 {match.powerschool.emails || match.powerschool.email || "-"}</span>
                            <span>📱 {match.powerschool.phones || match.powerschool.phone || "-"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

