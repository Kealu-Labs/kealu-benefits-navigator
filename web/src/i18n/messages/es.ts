/**
 * Copyright 2025 Kealu Inc. All rights reserved.
 * Licensed under the Kealu Vector License v1.0 — PATENT PENDING
 */
import type en from './en';

type Messages = {
  [K in keyof typeof en]: string;
};

const es: Messages = {
  // ── page.tsx ──────────────────────────────────────────────────────────────
  page_title: 'Navegador de Beneficios',
  page_subtitle:
    'Encuentre cobertura médica y programas de beneficios para su hogar — sin necesidad de cuenta.',
  offline_banner:
    'Motor de flujo de trabajo fuera de línea — el análisis no está disponible temporalmente. Vuelva pronto.',

  // ── chat-interface.tsx ───────────────────────────────────────────────────
  chat_welcome:
    'Hola. Soy un agente de IA impulsado por Kealu Vector para ayudarle a encontrar seguro médico y programas de beneficios para su hogar.\n\nLe haré algunas preguntas para entender su situación — no se necesita información de cuenta y su información siempre permanece privada.\n\nComencemos con lo básico. ¿Cuál es su código postal?\n\n(Su código postal nos indica qué planes de salud, programas estatales, servicios del condado, clínicas y opciones de asistencia local están disponibles donde vive.)',
  chat_welcome_back: '¡Bienvenido de nuevo! Continuando desde donde quedamos.',
  chat_ready:
    'Bien — tengo suficiente información para comenzar. Iniciando el análisis ahora…',
  chat_all_set: 'Todo listo — preparado para ejecutar',
  chat_run_prompt:
    "¡Todo listo! Haga clic en 'Ejecutar análisis' a continuación o escriba algo para iniciar el análisis de beneficios.",
  chat_error_generic: '⚠ Algo salió mal. Por favor intente de nuevo.',
  chat_unable_to_start: '⚠ No se puede iniciar el análisis',
  chat_please_retry: 'por favor intente de nuevo.',
  chat_hide_answers: 'Ocultar respuestas',
  chat_edit_answers: 'Editar respuestas',
  chat_save: 'Guardar',
  chat_cancel: 'Cancelar',
  chat_edit: 'Editar',
  chat_skip: 'Omitir preguntas restantes',
  chat_starting: 'Iniciando…',
  chat_run_analysis: 'Ejecutar análisis',
  chat_placeholder: 'Escriba su respuesta… (Intro para enviar, Shift+Intro para nueva línea)',
  chat_input_aria: 'Su mensaje',
  chat_send: 'Enviar',
  chat_send_aria: 'Enviar mensaje',

  // ── phase-tracker.tsx ────────────────────────────────────────────────────
  phase_benefits_research: 'Investigación de beneficios',
  phase_insurance_research: 'Investigación de seguros',
  phase_evidence_verification: 'Verificación de evidencia',
  phase_eligibility_validation: 'Validación de elegibilidad',
  phase_action_plan: 'Plan de acción',
  phase_status_idle: 'Esperando',
  phase_status_running: 'Ejecutando…',
  phase_status_rerunning: 'Re-verificando…',
  phase_status_complete: 'Completo',
  phase_status_error: 'Error',
  phase_analyzing: 'Analizando su hogar…',
  phase_description:
    'Se está ejecutando un flujo de trabajo de IA de 5 fases. Esto generalmente toma de 5 a 15 minutos.',
  phase_stopping: 'Deteniendo…',
  phase_stop_edit: 'Detener y editar',
  phase_finalizing: 'Finalizando…',
  phase_running_label: 'Ejecutando',
  phase_starting: 'Iniciando…',
  phase_progress_aria: 'Progreso general del análisis',
  phase_complete_aria: 'Completo',
  phase_error_aria: 'Error',

  // ── report-view.tsx ──────────────────────────────────────────────────────
  report_bottom_line: 'Conclusión',
  report_expand: 'expandir',
  report_collapse: 'contraer',
  report_starting: 'Iniciando…',
  report_run_again: 'Ejecutar de nuevo',

  // ── error-banner.tsx ─────────────────────────────────────────────────────
  error_try_again: 'Intentar de nuevo',
  error_edit_info: 'Editar mi información',

  // ── language-switcher.tsx ────────────────────────────────────────────────
  lang_select_aria: 'Seleccionar idioma',
  // Language names are always shown in the language itself
  lang_en: 'English',
  lang_es: 'Español',
  lang_zh_CN: '简体中文',
} as const;

export default es;
