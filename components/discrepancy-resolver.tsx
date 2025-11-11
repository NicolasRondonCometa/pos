"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { AlertTriangle, ChevronLeft, Check, Download, Edit2, Zap, ChevronRight, Loader2 } from "lucide-react"
import type { MatchedStudent } from "@/app/actions/credentials"
import * as XLSX from "xlsx"

interface DiscrepancyResolverProps {
  results: MatchedStudent[]
  onBack: () => void
  dataType?: "students" | "guardians" // Added dataType prop
}

interface ResolvedField {
  field: string
  value: string
  source: "partner" | "cometa" | "manual"
}

interface ResolvedStudent {
  studentId: string
  resolvedFields: ResolvedField[]
  originalData: MatchedStudent
}

interface FieldDiscrepancies {
  field: string
  fieldLabel: string
  discrepancies: Array<{
    studentId: string
    studentName: string
    partnerValue: string
    cometaValue: string
    student: MatchedStudent
  }>
}

const normalizeDateForComparison = (dateStr: string): string => {
  if (!dateStr) return ""
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return ""
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  } catch {
    return ""
  }
}

const compareStudentData = (partnerData: any, cometaData: any, dataType: "students" | "guardians") => {
  if (!partnerData || !cometaData) return {}

  const discrepancies: Record<string, { partner: string; cometa: string; field: string }> = {}

  if (dataType === "guardians") {
    // Comparar nombres de tutores
    const partnerName = `${partnerData.firstName || ""} ${partnerData.lastName || ""}`.trim().toLowerCase()
    const cometaName = `${cometaData.first_name || ""} ${cometaData.last_name || ""}`.trim().toLowerCase()
    if (partnerName && cometaName && partnerName !== cometaName) {
      discrepancies.nombre = {
        field: "nombre",
        partner: `${partnerData.firstName || ""} ${partnerData.lastName || ""}`.trim(),
        cometa: `${cometaData.first_name || ""} ${cometaData.last_name || ""}`.trim(),
      }
    }

    // Comparar email
    const partnerEmail = (partnerData.emails || "").toLowerCase()
    const cometaEmail = (cometaData.email || "").toLowerCase()
    if (partnerEmail && cometaEmail && partnerEmail !== cometaEmail) {
      discrepancies.email = {
        field: "email",
        partner: partnerData.emails || "-",
        cometa: cometaData.email || "-",
      }
    }

    // Comparar teléfono
    const normalizePhone = (phone: string) => phone.replace(/[\s\-$$$$]/g, "")
    const partnerPhone = normalizePhone(partnerData.phones || "")
    const cometaPhone = normalizePhone(cometaData.phone || "")
    if (partnerPhone && cometaPhone && partnerPhone !== cometaPhone) {
      discrepancies.telefono = {
        field: "telefono",
        partner: partnerData.phones || "-",
        cometa: cometaData.phone || "-",
      }
    }
  } else {
    // Comparar nombres de estudiantes
    const partnerName = `${partnerData.first_name || ""} ${partnerData.last_name || ""}`.trim().toLowerCase()
    const cometaName = `${cometaData.first_name || ""} ${cometaData.last_name || ""}`.trim().toLowerCase()
    if (partnerName && cometaName && partnerName !== cometaName) {
      discrepancies.nombre = {
        field: "nombre",
        partner: `${partnerData.first_name || ""} ${partnerData.last_name || ""}`.trim(),
        cometa: `${cometaData.first_name || ""} ${cometaData.last_name || ""}`.trim(),
      }
    }

    // Comparar CURP
    const partnerCURP = (partnerData.curp || partnerData.state_studentnumber || "").toLowerCase()
    const cometaCURP = (cometaData.identifier || "").toLowerCase()
    if (partnerCURP && cometaCURP && partnerCURP !== cometaCURP) {
      discrepancies.curp = {
        field: "curp",
        partner: partnerData.curp || partnerData.state_studentnumber || "-",
        cometa: cometaData.identifier || "-",
      }
    }

    // Comparar fecha de nacimiento
    const partnerDOB = partnerData.dob || partnerData.birthdate || ""
    const cometaDOB = cometaData.birthdate || ""
    const normalizedPartnerDOB = normalizeDateForComparison(partnerDOB)
    const normalizedCometaDOB = normalizeDateForComparison(cometaDOB)

    if (normalizedPartnerDOB && normalizedCometaDOB && normalizedPartnerDOB !== normalizedCometaDOB) {
      discrepancies.fecha_nacimiento = {
        field: "fecha_nacimiento",
        partner: normalizedPartnerDOB,
        cometa: normalizedCometaDOB,
      }
    }

    // Comparar género
    const partnerGender = (partnerData.gender || "").toUpperCase()
    const cometaGender = (cometaData.gender || "").toUpperCase()
    if (partnerGender && cometaGender && partnerGender !== cometaGender) {
      discrepancies.genero = {
        field: "genero",
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
          // Ignore
        }
      } else if (typeof cometaSection === "object") {
        cometaGrade = String(cometaSection.grade || "")
      }
    }
    if (partnerGrade && cometaGrade && partnerGrade !== cometaGrade) {
      discrepancies.grado = {
        field: "grado",
        partner: partnerGrade,
        cometa: cometaGrade,
      }
    }
  }

  return discrepancies
}

export function DiscrepancyResolver({ results, onBack, dataType = "students" }: DiscrepancyResolverProps) {
  const fieldDiscrepanciesMap = new Map<string, FieldDiscrepancies>()

  results.forEach((student) => {
    const discrepancies = compareStudentData(student.partnerData, student.cometaData, dataType)

    Object.values(discrepancies).forEach((disc) => {
      if (!fieldDiscrepanciesMap.has(disc.field)) {
        fieldDiscrepanciesMap.set(disc.field, {
          field: disc.field,
          fieldLabel: disc.field.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase()),
          discrepancies: [],
        })
      }

      fieldDiscrepanciesMap.get(disc.field)!.discrepancies.push({
        studentId: student.partnerData?.id || student.cometaData?.id || "",
        studentName: `${student.partnerData?.first_name || student.cometaData?.first_name || ""} ${
          student.partnerData?.last_name || student.cometaData?.last_name || ""
        }`.trim(),
        partnerValue: disc.partner,
        cometaValue: disc.cometa,
        student,
      })
    })
  })

  const fieldDiscrepancies = Array.from(fieldDiscrepanciesMap.values())

  const [currentFieldIndex, setCurrentFieldIndex] = useState(0)
  const [fieldResolution, setFieldResolution] = useState<"partner" | "cometa" | "manual" | null>(null)
  const [selectedOption, setSelectedOption] = useState<"partner" | "cometa" | "manual" | null>(null)
  const [currentStudentIndex, setCurrentStudentIndex] = useState(0)
  const [resolvedStudents, setResolvedStudents] = useState<ResolvedStudent[]>([])
  const [editValue, setEditValue] = useState("")
  const [isDownloading, setIsDownloading] = useState(false)

  const currentField = fieldDiscrepancies[currentFieldIndex]
  const progress = ((currentFieldIndex + 1) / fieldDiscrepancies.length) * 100

  const handleApplyToAll = (source: "partner" | "cometa") => {
    const newResolved = [...resolvedStudents]

    currentField.discrepancies.forEach((disc) => {
      const value = source === "partner" ? disc.partnerValue : disc.cometaValue
      const existingIndex = newResolved.findIndex((r) => r.studentId === disc.studentId)

      const newResolvedField: ResolvedField = {
        field: currentField.field,
        value,
        source,
      }

      if (existingIndex >= 0) {
        newResolved[existingIndex].resolvedFields = [
          ...newResolved[existingIndex].resolvedFields.filter((f) => f.field !== currentField.field),
          newResolvedField,
        ]
      } else {
        newResolved.push({
          studentId: disc.studentId,
          resolvedFields: [newResolvedField],
          originalData: disc.student,
        })
      }
    })

    setResolvedStudents(newResolved)
    setSelectedOption(null)

    handleNextField()
  }

  const handleReviewManually = () => {
    setFieldResolution("manual")
    setCurrentStudentIndex(0)
  }

  const handleSaveManualValue = () => {
    const currentDiscrepancy = currentField.discrepancies[currentStudentIndex]
    const existingIndex = resolvedStudents.findIndex((r) => r.studentId === currentDiscrepancy.studentId)

    const newResolvedField: ResolvedField = {
      field: currentField.field,
      value: editValue,
      source: "manual",
    }

    if (existingIndex >= 0) {
      const newResolved = [...resolvedStudents]
      newResolved[existingIndex].resolvedFields = [
        ...newResolved[existingIndex].resolvedFields.filter((f) => f.field !== currentField.field),
        newResolvedField,
      ]
      setResolvedStudents(newResolved)
    } else {
      setResolvedStudents([
        ...resolvedStudents,
        {
          studentId: currentDiscrepancy.studentId,
          resolvedFields: [newResolvedField],
          originalData: currentDiscrepancy.student,
        },
      ])
    }

    if (currentStudentIndex < currentField.discrepancies.length - 1) {
      setCurrentStudentIndex(currentStudentIndex + 1)
      setEditValue("")
    } else {
      handleNextField()
    }
  }

  const handleSelectValueForStudent = (value: string, source: "partner" | "cometa") => {
    const currentDiscrepancy = currentField.discrepancies[currentStudentIndex]
    const existingIndex = resolvedStudents.findIndex((r) => r.studentId === currentDiscrepancy.studentId)

    const newResolvedField: ResolvedField = {
      field: currentField.field,
      value,
      source,
    }

    if (existingIndex >= 0) {
      const newResolved = [...resolvedStudents]
      newResolved[existingIndex].resolvedFields = [
        ...newResolved[existingIndex].resolvedFields.filter((f) => f.field !== currentField.field),
        newResolvedField,
      ]
      setResolvedStudents(newResolved)
    } else {
      setResolvedStudents([
        ...resolvedStudents,
        {
          studentId: currentDiscrepancy.studentId,
          resolvedFields: [newResolvedField],
          originalData: currentDiscrepancy.student,
        },
      ])
    }

    if (currentStudentIndex < currentField.discrepancies.length - 1) {
      setCurrentStudentIndex(currentStudentIndex + 1)
    } else {
      handleNextField()
    }
  }

  const handleNextField = () => {
    if (currentFieldIndex < fieldDiscrepancies.length - 1) {
      setCurrentFieldIndex(currentFieldIndex + 1)
      setFieldResolution(null)
      setCurrentStudentIndex(0)
      setEditValue("")
      setSelectedOption(null)
    }
  }

  const handlePreviousField = () => {
    if (currentFieldIndex > 0) {
      setCurrentFieldIndex(currentFieldIndex - 1)
      setFieldResolution(null)
      setCurrentStudentIndex(0)
      setEditValue("")
      setSelectedOption(null)
    }
  }

  const handleDownload = async () => {
    if (isDownloading) return

    setIsDownloading(true)
    console.log("[v0] Iniciando descarga de Excel...")

    try {
      const studentsWithDiscrepancies = resolvedStudents.map((resolved) => {
        const student = resolved.originalData
        const partnerData = student.partnerData || {}
        const cometaData = student.cometaData || {}

        // Datos base del estudiante
        const row: any = {
          ID: partnerData.id || cometaData.id || "",
          "Nombre Completo": `${partnerData.first_name || cometaData.first_name || ""} ${
            partnerData.last_name || cometaData.last_name || ""
          }`.trim(),
          "Matrícula (Local ID)": partnerData.local_id || cometaData.enrollment_code || "",
          CURP: "",
          "Fecha de Nacimiento": "",
          Género: "",
          Grado: "",
          "Campos Modificados": "",
          "Fuente de Datos": "",
        }

        const modifiedFields: string[] = []
        const sources: string[] = []

        resolved.resolvedFields.forEach((field) => {
          const sourceLabel =
            field.source === "partner" ? "PowerSchool" : field.source === "cometa" ? "Cometa" : "Manual"

          modifiedFields.push(field.field)
          sources.push(`${field.field}: ${sourceLabel}`)

          // Asignar el valor resuelto al campo correspondiente
          if (field.field === "nombre") {
            row["Nombre Completo"] = field.value
          } else if (field.field === "curp") {
            row.CURP = field.value
          } else if (field.field === "fecha_nacimiento") {
            row["Fecha de Nacimiento"] = field.value
          } else if (field.field === "genero") {
            row.Género = field.value
          } else if (field.field === "grado") {
            row.Grado = field.value
          } else if (field.field === "email") {
            row.Email = field.value
          } else if (field.field === "telefono") {
            row.Teléfono = field.value
          }
        })

        // Rellenar campos que no fueron modificados con valores por defecto
        if (!row.CURP) {
          row.CURP = partnerData.curp || partnerData.state_studentnumber || cometaData.identifier || ""
        }
        if (!row["Fecha de Nacimiento"]) {
          row["Fecha de Nacimiento"] =
            normalizeDateForComparison(partnerData.dob || partnerData.birthdate || "") ||
            normalizeDateForComparison(cometaData.birthdate || "")
        }
        if (!row.Género) {
          row.Género = partnerData.gender || cometaData.gender || ""
        }
        if (!row.Grado) {
          row.Grado =
            partnerData.grade_level || partnerData.grade || partnerData.gradelevel || partnerData.current_grade || ""
        }
        if (!row.Email && dataType === "guardians") {
          row.Email = partnerData.emails || cometaData.email || ""
        }
        if (!row.Teléfono && dataType === "guardians") {
          row.Teléfono = partnerData.phones || cometaData.phone || ""
        }

        row["Campos Modificados"] = modifiedFields.join(", ")
        row["Fuente de Datos"] = sources.join(" | ")

        return row
      })

      console.log(
        "[v0] Datos consolidados preparados:",
        studentsWithDiscrepancies.length,
        "estudiantes con discrepancias resueltas",
      )

      // Crear libro de Excel con múltiples hojas
      const wb = XLSX.utils.book_new()

      // Hoja 1: Datos consolidados
      const ws1 = XLSX.utils.json_to_sheet(studentsWithDiscrepancies)
      XLSX.utils.book_append_sheet(wb, ws1, "Estudiantes Consolidados")

      // Hoja 2: Resumen de cambios
      const changesData = resolvedStudents.flatMap((resolved) => {
        const student = resolved.originalData
        const studentName = `${student.partnerData?.first_name || student.cometaData?.first_name || ""} ${
          student.partnerData?.last_name || student.cometaData?.last_name || ""
        }`.trim()

        return resolved.resolvedFields.map((field) => ({
          Estudiante: studentName,
          "ID Estudiante": resolved.studentId,
          Campo: field.field.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase()),
          "Valor Final": field.value,
          Fuente: field.source === "partner" ? "PowerSchool" : field.source === "cometa" ? "Cometa" : "Manual",
        }))
      })

      if (changesData.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(changesData)
        XLSX.utils.book_append_sheet(wb, ws2, "Detalle de Cambios")
      }

      console.log("[v0] Libro de Excel creado, generando archivo...")

      // Generar archivo Excel como array buffer
      const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" })

      // Crear Blob y descargar
      const blob = new Blob([excelBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `estudiantes-discrepancias-resueltas-${new Date().toISOString().split("T")[0]}.xlsx`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      console.log("[v0] Descarga de Excel completada")
    } catch (error) {
      console.error("[v0] Error al descargar Excel:", error)
    } finally {
      setTimeout(() => {
        setIsDownloading(false)
      }, 1000)
    }
  }

  const handleApplyToRemaining = (source: "partner" | "cometa") => {
    const newResolved = [...resolvedStudents]

    // Aplicar solo a los estudiantes que aún no han sido revisados
    for (let i = currentStudentIndex; i < currentField.discrepancies.length; i++) {
      const disc = currentField.discrepancies[i]
      const value = source === "partner" ? disc.partnerValue : disc.cometaValue
      const existingIndex = newResolved.findIndex((r) => r.studentId === disc.studentId)

      const newResolvedField: ResolvedField = {
        field: currentField.field,
        value,
        source,
      }

      if (existingIndex >= 0) {
        newResolved[existingIndex].resolvedFields = [
          ...newResolved[existingIndex].resolvedFields.filter((f) => f.field !== currentField.field),
          newResolvedField,
        ]
      } else {
        newResolved.push({
          studentId: disc.studentId,
          resolvedFields: [newResolvedField],
          originalData: disc.student,
        })
      }
    }

    setResolvedStudents(newResolved)
    handleNextField()
  }

  const handleSelectOption = (option: "partner" | "cometa" | "manual") => {
    setSelectedOption(option)
  }

  const handleConfirmSelection = () => {
    if (!selectedOption) return

    if (selectedOption === "manual") {
      setFieldResolution("manual")
      setCurrentStudentIndex(0)
      setSelectedOption(null)
    } else {
      handleApplyToAll(selectedOption)
    }
  }

  const isLastField = currentFieldIndex === fieldDiscrepancies.length - 1

  const entityLabel = dataType === "guardians" ? "tutores" : "estudiantes"
  const entityLabelSingular = dataType === "guardians" ? "tutor" : "estudiante"

  if (fieldDiscrepancies.length === 0) {
    return (
      <Card className="border-neutral-200 bg-white shadow-sm">
        <CardContent className="flex flex-col items-center justify-center p-12 space-y-4">
          <Check className="h-16 w-16 text-success-500" />
          <div className="text-center space-y-2">
            <h3 className="text-xl font-semibold text-neutral-900 font-lota">No hay discrepancias para resolver</h3>
            <p className="text-neutral-600">Todos los {entityLabel} tienen datos consistentes entre ambos sistemas</p>
          </div>
          <Button onClick={onBack} className="bg-galaxy-500 hover:bg-galaxy-600 text-white">
            Volver a Resultados
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!fieldResolution) {
    return (
      <div className="space-y-6">
        <Card className="border-neutral-200 bg-white shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-neutral-900 font-lota text-2xl">Resolver Discrepancias por Campo</CardTitle>
                <CardDescription className="text-neutral-600">
                  Campo {currentFieldIndex + 1} de {fieldDiscrepancies.length}: {currentField.fieldLabel}
                </CardDescription>
              </div>
              <Badge variant="secondary" className="bg-warning-50 text-warning-700 border-warning-200">
                <AlertTriangle className="h-4 w-4 mr-1" />
                {currentField.discrepancies.length} {entityLabelSingular}
                {currentField.discrepancies.length !== 1 ? "es" : ""}
              </Badge>
            </div>
            <Progress value={progress} className="mt-4" />
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
              <h4 className="font-semibold text-neutral-900 mb-3">
                {currentField.discrepancies.length} {entityLabelSingular}
                {currentField.discrepancies.length !== 1 ? "es" : ""} con discrepancias en:{" "}
                <span className="text-galaxy-600">{currentField.fieldLabel}</span>
              </h4>
              <p className="text-sm text-neutral-600">
                Puedes aplicar una resolución general para todos los {entityLabel} o revisar cada uno manualmente.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <Card
                className={`cursor-pointer transition-all ${
                  selectedOption === "partner"
                    ? "border-galaxy-500 border-2 bg-galaxy-100 shadow-lg ring-2 ring-galaxy-300"
                    : "border-galaxy-200 bg-galaxy-50 hover:border-galaxy-400 hover:shadow-md"
                }`}
                onClick={() => handleSelectOption("partner")}
              >
                <CardContent className="p-6 text-center space-y-3 relative">
                  {selectedOption === "partner" && (
                    <div className="absolute top-2 right-2 bg-galaxy-500 rounded-full p-1">
                      <Check className="h-4 w-4 text-white" />
                    </div>
                  )}
                  <Zap className="h-8 w-8 text-galaxy-600 mx-auto" />
                  <div>
                    <p className="font-semibold text-neutral-900 mb-1">Usar PowerSchool</p>
                    <p className="text-xs text-neutral-600">
                      Aplicar valores de PowerSchool para todos los {currentField.discrepancies.length}{" "}
                      {entityLabelSingular}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={`cursor-pointer transition-all ${
                  selectedOption === "cometa"
                    ? "border-aurora-500 border-2 bg-aurora-100 shadow-lg ring-2 ring-aurora-300"
                    : "border-aurora-200 bg-aurora-50 hover:border-aurora-400 hover:shadow-md"
                }`}
                onClick={() => handleSelectOption("cometa")}
              >
                <CardContent className="p-6 text-center space-y-3 relative">
                  {selectedOption === "cometa" && (
                    <div className="absolute top-2 right-2 bg-aurora-500 rounded-full p-1">
                      <Check className="h-4 w-4 text-white" />
                    </div>
                  )}
                  <Zap className="h-8 w-8 text-aurora-600 mx-auto" />
                  <div>
                    <p className="font-semibold text-neutral-900 mb-1">Usar Cometa</p>
                    <p className="text-xs text-neutral-600">
                      Aplicar valores de Cometa para todos los {currentField.discrepancies.length} {entityLabelSingular}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={`cursor-pointer transition-all ${
                  selectedOption === "manual"
                    ? "border-horizon-500 border-2 bg-horizon-100 shadow-lg ring-2 ring-horizon-300"
                    : "border-horizon-200 bg-horizon-50 hover:border-horizon-400 hover:shadow-md"
                }`}
                onClick={() => handleSelectOption("manual")}
              >
                <CardContent className="p-6 text-center space-y-3 relative">
                  {selectedOption === "manual" && (
                    <div className="absolute top-2 right-2 bg-horizon-500 rounded-full p-1">
                      <Check className="h-4 w-4 text-white" />
                    </div>
                  )}
                  <Edit2 className="h-8 w-8 text-horizon-600 mx-auto" />
                  <div>
                    <p className="font-semibold text-neutral-900 mb-1">Revisar Manualmente</p>
                    <p className="text-xs text-neutral-600">
                      Revisar y decidir para cada uno de los {currentField.discrepancies.length} {entityLabelSingular}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {selectedOption && (
              <div className="flex justify-center pt-4">
                <Button
                  onClick={handleConfirmSelection}
                  size="lg"
                  className="bg-success-500 hover:bg-success-600 text-white px-8"
                >
                  {selectedOption === "manual" ? (
                    <>
                      Comenzar Revisión Manual
                      <ChevronRight className="h-5 w-5 ml-2" />
                    </>
                  ) : isLastField ? (
                    <>
                      <Check className="h-5 w-5 mr-2" />
                      Aplicar y Finalizar
                    </>
                  ) : (
                    <>
                      Aplicar y Continuar
                      <ChevronRight className="h-5 w-5 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            )}

            {isLastField && !selectedOption && resolvedStudents.length > 0 && (
              <div className="flex justify-center pt-4">
                <Button
                  onClick={handleDownload}
                  disabled={isDownloading}
                  size="lg"
                  className="bg-galaxy-500 hover:bg-galaxy-600 text-white px-8 disabled:opacity-50"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Descargando...
                    </>
                  ) : (
                    <>
                      <Download className="h-5 w-5 mr-2" />
                      Descargar Resultado Consolidado
                    </>
                  )}
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-neutral-200">
              <Button
                variant="outline"
                onClick={handlePreviousField}
                disabled={currentFieldIndex === 0}
                className="border-neutral-300 hover:border-galaxy-400 hover:bg-galaxy-50 bg-transparent"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Campo Anterior
              </Button>

              <Button variant="outline" onClick={onBack} className="border-neutral-300 bg-transparent">
                Volver a Resultados
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const currentDiscrepancy = currentField.discrepancies[currentStudentIndex]
  const studentProgress = ((currentStudentIndex + 1) / currentField.discrepancies.length) * 100
  const remainingCount = currentField.discrepancies.length - currentStudentIndex

  return (
    <div className="space-y-6">
      <Card className="border-neutral-200 bg-white shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-neutral-900 font-lota text-2xl">
                Revisión Manual: {currentField.fieldLabel}
              </CardTitle>
              <CardDescription className="text-neutral-600">
                Estudiante {currentStudentIndex + 1} de {currentField.discrepancies.length}
              </CardDescription>
            </div>
            <Badge variant="secondary" className="bg-horizon-50 text-horizon-700 border-horizon-200">
              Campo {currentFieldIndex + 1}/{fieldDiscrepancies.length}
            </Badge>
          </div>
          <Progress value={studentProgress} className="mt-4" />
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
            <h4 className="font-semibold text-neutral-900 mb-2">{currentDiscrepancy.studentName}</h4>
            <p className="text-sm text-neutral-600">Selecciona el valor correcto para {currentField.fieldLabel}</p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <Card
              className="cursor-pointer transition-all border-galaxy-200 bg-galaxy-50 hover:border-galaxy-400 hover:shadow-md"
              onClick={() => handleSelectValueForStudent(currentDiscrepancy.partnerValue, "partner")}
            >
              <CardContent className="p-6">
                <p className="text-xs text-galaxy-600 font-medium mb-2">PowerSchool</p>
                <p className="text-lg font-semibold text-neutral-900">{currentDiscrepancy.partnerValue}</p>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer transition-all border-aurora-200 bg-aurora-50 hover:border-aurora-400 hover:shadow-md"
              onClick={() => handleSelectValueForStudent(currentDiscrepancy.cometaValue, "cometa")}
            >
              <CardContent className="p-6">
                <p className="text-xs text-aurora-600 font-medium mb-2">Cometa</p>
                <p className="text-lg font-semibold text-neutral-900">{currentDiscrepancy.cometaValue}</p>
              </CardContent>
            </Card>

            <Card className="border-horizon-200 bg-horizon-50">
              <CardContent className="p-6 space-y-3">
                <Label htmlFor="manual-edit" className="text-xs text-horizon-600 font-medium">
                  Valor Manual
                </Label>
                <Input
                  id="manual-edit"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Escribe un valor..."
                  className="mb-2"
                />
                <Button
                  onClick={handleSaveManualValue}
                  disabled={!editValue}
                  className="w-full bg-horizon-500 hover:bg-horizon-600 text-white"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Guardar
                </Button>
              </CardContent>
            </Card>
          </div>

          {remainingCount > 1 && (
            <div className="p-4 bg-warning-50 rounded-lg border border-warning-200">
              <p className="text-sm text-warning-800 font-medium mb-3">
                Quedan {remainingCount} {entityLabelSingular}
                {remainingCount !== 1 ? "es" : ""} por revisar en este campo
              </p>
              <div className="flex gap-3">
                <Button
                  onClick={() => handleApplyToRemaining("partner")}
                  variant="outline"
                  size="sm"
                  className="flex-1 border-galaxy-300 hover:bg-galaxy-100"
                >
                  <Zap className="h-4 w-4 mr-1" />
                  Aplicar PowerSchool a los restantes
                </Button>
                <Button
                  onClick={() => handleApplyToRemaining("cometa")}
                  variant="outline"
                  size="sm"
                  className="flex-1 border-aurora-300 hover:bg-aurora-100"
                >
                  <Zap className="h-4 w-4 mr-1" />
                  Aplicar Cometa a los restantes
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-neutral-200">
            <Button
              variant="outline"
              onClick={() => {
                setFieldResolution(null)
                setCurrentStudentIndex(0)
              }}
              className="border-neutral-300"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Volver a Opciones
            </Button>

            {currentFieldIndex === fieldDiscrepancies.length - 1 &&
              currentStudentIndex === currentField.discrepancies.length - 1 && (
                <Button
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="bg-success-500 hover:bg-success-600 text-white disabled:opacity-50"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Descargando...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Descargar Consolidado
                    </>
                  )}
                </Button>
              )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
