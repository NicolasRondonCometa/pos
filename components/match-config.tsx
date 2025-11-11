"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, ArrowUp, ArrowDown, Settings2, Play } from "lucide-react"
import type { MatchRule } from "@/app/actions/credentials"

interface MatchConfigProps {
  onBack: () => void
  onStartMatch: (rules: MatchRule[]) => void
  dataType?: "students" | "guardians"
  disabled?: boolean
}

const STUDENT_RULES: MatchRule[] = [
  {
    id: "matricula",
    name: "Matrícula",
    description: "Coincidencia exacta de matrícula (ignorando mayúsculas, espacios y guiones)",
    priority: 1,
    enabled: true,
  },
  {
    id: "curp",
    name: "CURP",
    description: "Coincidencia exacta del CURP",
    priority: 2,
    enabled: true,
  },
  {
    id: "name_dob",
    name: "Nombre + Fecha de Nacimiento",
    description: "Nombre completo normalizado y fecha de nacimiento en formato ISO (YYYY-MM-DD)",
    priority: 3,
    enabled: true,
  },
]

const GUARDIAN_RULES: MatchRule[] = [
  {
    id: "phone",
    name: "Teléfono",
    description: "Coincidencia exacta del número de teléfono en formato E.164",
    priority: 1,
    enabled: true,
  },
  {
    id: "email",
    name: "Email",
    description: "Coincidencia exacta del correo electrónico (convertido a minúsculas)",
    priority: 2,
    enabled: true,
  },
  {
    id: "name",
    name: "Nombre Completo",
    description: "Nombre completo normalizado (sin acentos, Title-Case)",
    priority: 3,
    enabled: true,
  },
]

export function MatchConfig({ onBack, onStartMatch, dataType = "students", disabled = false }: MatchConfigProps) {
  const defaultRules = dataType === "guardians" ? GUARDIAN_RULES : STUDENT_RULES
  const [rules, setRules] = useState<MatchRule[]>(defaultRules)

  useEffect(() => {
    const newRules = dataType === "guardians" ? GUARDIAN_RULES : STUDENT_RULES
    setRules(newRules)
  }, [dataType])

  const handleToggleRule = (ruleId: string) => {
    setRules((prev) => prev.map((rule) => (rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule)))
  }

  const handleMovePriority = (ruleId: string, direction: "up" | "down") => {
    setRules((prev) => {
      const index = prev.findIndex((r) => r.id === ruleId)
      if (index === -1) return prev

      const newRules = [...prev]
      const targetIndex = direction === "up" ? index - 1 : index + 1

      if (targetIndex < 0 || targetIndex >= newRules.length) return prev

      // Intercambiar prioridades
      const temp = newRules[index].priority
      newRules[index].priority = newRules[targetIndex].priority
      newRules[targetIndex].priority = temp

      // Ordenar por prioridad
      return newRules.sort((a, b) => a.priority - b.priority)
    })
  }

  const enabledRulesCount = rules.filter((r) => r.enabled).length
  const entityLabel = dataType === "guardians" ? "tutores" : "estudiantes"

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} className="text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Volver
      </Button>

      <Card className="border-neutral-200 bg-white shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-horizon-100">
                  <Settings2 className="h-5 w-5 text-horizon-600" />
                </div>
                <div>
                  <CardTitle className="text-neutral-900 font-lota text-2xl">Configuración de Matching</CardTitle>
                  <CardDescription className="text-neutral-600 mt-1">
                    Configure las reglas y prioridades para emparejar {entityLabel}
                  </CardDescription>
                </div>
              </div>
            </div>
            <Badge
              variant="secondary"
              className="bg-horizon-50 text-horizon-700 border-horizon-200 px-3 py-1.5 text-sm font-semibold"
            >
              {enabledRulesCount} {enabledRulesCount === 1 ? "regla activa" : "reglas activas"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-galaxy-50 border border-galaxy-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-galaxy-900 mb-2">¿Cómo funciona el matching?</h3>
            <p className="text-sm text-galaxy-700 leading-relaxed">
              El sistema comparará los {entityLabel} del partner (PowerSchool) con los {entityLabel} en Cometa usando
              las reglas que configure a continuación. Las reglas se aplican en orden de prioridad hasta encontrar una
              coincidencia.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-neutral-900">Reglas de Emparejamiento</h3>
            <p className="text-sm text-neutral-600">
              Ordene las reglas por prioridad. La primera regla que encuentre una coincidencia se usará.
            </p>

            <div className="space-y-2">
              {rules.map((rule, index) => (
                <Card
                  key={rule.id}
                  className={`border-2 transition-all ${
                    rule.enabled ? "border-galaxy-200 bg-galaxy-50/50" : "border-neutral-200 bg-neutral-50 opacity-60"
                  }`}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    <Checkbox checked={rule.enabled} onCheckedChange={() => handleToggleRule(rule.id)} />

                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-galaxy-100 text-galaxy-700 font-bold text-sm">
                      {rule.priority}
                    </div>

                    <div className="flex-1">
                      <h4 className="font-semibold text-neutral-900 font-lota">{rule.name}</h4>
                      <p className="text-sm text-neutral-600">{rule.description}</p>
                    </div>

                    <div className="flex flex-col gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMovePriority(rule.id, "up")}
                        disabled={index === 0}
                        className="h-7 w-7 p-0 hover:bg-galaxy-100"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMovePriority(rule.id, "down")}
                        disabled={index === rules.length - 1}
                        className="h-7 w-7 p-0 hover:bg-galaxy-100"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="bg-aurora-50 border border-aurora-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-aurora-900 mb-2">Resultados del Matching</h3>
            <ul className="text-sm text-aurora-700 space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="font-bold mt-0.5">•</span>
                <span>
                  <strong>Matched:</strong> {entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1)} encontrados en
                  ambos sistemas
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold mt-0.5">•</span>
                <span>
                  <strong>Solo Partner:</strong> {entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1)} que solo
                  existen en PowerSchool
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold mt-0.5">•</span>
                <span>
                  <strong>Solo Cometa:</strong> {entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1)} que solo
                  existen en Cometa
                </span>
              </li>
            </ul>
          </div>

          <Button
            onClick={() => onStartMatch(rules)}
            disabled={enabledRulesCount === 0 || disabled}
            className="w-full bg-galaxy-500 hover:bg-galaxy-600 text-white font-medium h-12 text-base disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="mr-2 h-5 w-5" />
            {disabled
              ? "Cargando datos..."
              : `Iniciar Matching con ${enabledRulesCount} ${enabledRulesCount === 1 ? "regla" : "reglas"}`}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
