"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, ChevronLeft, ChevronRight, Users, UserCheck, Filter } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface Student {
  [key: string]: any
}

interface StudentsTableProps {
  students: Student[]
  schoolName?: string
  dataType: "students" | "guardians"
}

const ITEMS_PER_PAGE = 10

export function StudentsTable({ students, schoolName, dataType }: StudentsTableProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)

  const title = dataType === "students" ? "Estudiantes" : "Tutores"
  const Icon = dataType === "students" ? Users : UserCheck
  const iconBgColor = dataType === "students" ? "bg-galaxy-100 text-galaxy-600" : "bg-aurora-100 text-aurora-600"
  const badgeColor =
    dataType === "students"
      ? "bg-galaxy-50 text-galaxy-700 border-galaxy-200"
      : "bg-aurora-50 text-aurora-700 border-aurora-200"
  const itemLabel = dataType === "students" ? "estudiantes" : "tutores"
  const itemLabelSingular = dataType === "students" ? "estudiante" : "tutor"

  const columns = useMemo(() => {
    if (students.length === 0) return []
    return Object.keys(students[0]).map((key) => ({
      key,
      label: key
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    }))
  }, [students])

  // Filtrar estudiantes basado en el término de búsqueda
  const filteredStudents = useMemo(() => {
    if (!searchTerm) return students

    return students.filter((student) =>
      Object.values(student).some((value) => String(value).toLowerCase().includes(searchTerm.toLowerCase())),
    )
  }, [students, searchTerm])

  // Calcular paginación
  const totalPages = Math.ceil(filteredStudents.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const currentStudents = filteredStudents.slice(startIndex, endIndex)

  // Resetear a la primera página cuando cambia el término de búsqueda
  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setCurrentPage(1)
  }

  const handlePreviousPage = () => {
    setCurrentPage((prev) => Math.max(1, prev - 1))
  }

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages, prev + 1))
  }

  return (
    <Card className="border-neutral-200 bg-gradient-to-br from-white to-neutral-25 shadow-lg">
      <CardHeader className="border-b border-neutral-100 bg-white/80 backdrop-blur-sm">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBgColor}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-neutral-900 font-lota text-2xl font-semibold">{title}</CardTitle>
                {schoolName && <p className="text-sm text-neutral-600 font-medium mt-0.5">{schoolName}</p>}
              </div>
            </div>
          </div>
          <Badge variant="secondary" className={`${badgeColor} px-3 py-1.5 text-sm font-semibold`}>
            {filteredStudents.length} {filteredStudents.length !== 1 ? itemLabel : itemLabelSingular}
          </Badge>
        </div>
        {searchTerm && (
          <CardDescription className="text-neutral-600 flex items-center gap-2 mt-3">
            <Filter className="h-4 w-4 text-galaxy-500" />
            Mostrando resultados filtrados de {students.length} {itemLabel} totales
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-neutral-400 group-focus-within:text-galaxy-500 transition-colors" />
          <Input
            type="text"
            placeholder="Buscar por nombre, ID, email o cualquier campo..."
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

        <div className="border border-neutral-200 rounded-xl overflow-hidden shadow-sm bg-white">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gradient-to-r from-neutral-50 to-neutral-25 border-b border-neutral-200 hover:bg-neutral-50">
                  {columns.map((column) => (
                    <TableHead
                      key={column.key}
                      className="font-semibold text-neutral-900 font-lota text-sm h-12 px-6 first:pl-8 last:pr-8"
                    >
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentStudents.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="text-center py-16 text-neutral-500 first:pl-8 last:pr-8"
                    >
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100">
                          <Search className="h-8 w-8 text-neutral-400" />
                        </div>
                        <div className="space-y-1">
                          <p className="font-medium text-neutral-700">
                            {searchTerm ? `No se encontraron ${itemLabel}` : `No hay ${itemLabel} disponibles`}
                          </p>
                          <p className="text-sm text-neutral-500">
                            {searchTerm
                              ? "Intenta con otros términos de búsqueda"
                              : "No hay datos para mostrar en este momento"}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  currentStudents.map((student, index) => (
                    <TableRow
                      key={index}
                      className="hover:bg-galaxy-50/50 transition-colors border-b border-neutral-100 last:border-0"
                    >
                      {columns.map((column) => (
                        <TableCell
                          key={column.key}
                          className="text-neutral-700 py-4 px-6 first:pl-8 last:pr-8 font-medium text-sm"
                        >
                          {String(student[column.key] ?? "-")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
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
                  {startIndex + 1}-{Math.min(endIndex, filteredStudents.length)}
                </span>{" "}
                de <span className="text-neutral-900 font-semibold">{filteredStudents.length}</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviousPage}
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
                onClick={handleNextPage}
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
  )
}
