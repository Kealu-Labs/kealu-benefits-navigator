/**
 * Copyright 2025 Kealu Inc. All rights reserved.
 * Licensed under the Kealu Vector License v1.0 — PATENT PENDING
 */

import type { Messages } from '@/i18n';

const zhCN: Messages = {
  page_title: '福利导航器',
  page_subtitle:
    '为您的家庭查找医疗保险和福利项目 — 无需创建账户。',
  offline_banner:
    '工作流引擎离线 — 分析暂时不可用。请稍后再试。',

  chat_welcome:
    '您好。我是由 Kealu Vector 提供支持的 AI 助手，可以帮助您为家庭寻找医疗保险和福利项目。\n\n我会询问几个问题来了解您的情况 — 无需账户信息，您的信息始终保持私密。\n\n让我们从基础信息开始。您的邮政编码是多少？\n\n（您的邮政编码可以帮助我们确定您所在地区可用的健康计划、州项目、县服务、诊所和本地援助选项。）',
  chat_welcome_back: '欢迎回来！让我们从上次的位置继续。',
  chat_ready: '很好 — 我已有足够的信息开始。正在启动分析…',
  chat_all_set: '全部完成 — 可以开始运行',
  chat_run_prompt:
    '全部完成！点击下面的“运行分析”或输入任意内容开始福利分析。',
  chat_error_generic: '⚠ 出现问题。请重试。',
  chat_unable_to_start: '⚠ 无法启动分析',
  chat_please_retry: '请重试。',
  chat_hide_answers: '隐藏答案',
  chat_edit_answers: '编辑答案',
  chat_save: '保存',
  chat_cancel: '取消',
  chat_edit: '编辑',
  chat_skip: '跳过剩余问题',
  chat_starting: '正在启动…',
  chat_run_analysis: '运行分析',
  chat_placeholder: '输入您的回答…（Enter 发送，Shift+Enter 换行）',
  chat_input_aria: '您的消息',
  chat_send: '发送',
  chat_send_aria: '发送消息',

  phase_benefits_research: '福利研究',
  phase_insurance_research: '保险研究',
  phase_evidence_verification: '证据验证',
  phase_eligibility_validation: '资格验证',
  phase_action_plan: '行动计划',
  phase_status_idle: '等待中',
  phase_status_running: '运行中…',
  phase_status_rerunning: '重新检查中…',
  phase_status_complete: '完成',
  phase_status_error: '错误',
  phase_analyzing: '正在分析您的家庭情况…',
  phase_description:
    '正在运行一个 5 阶段 AI 工作流。通常需要 5–15 分钟。',
  phase_stopping: '正在停止…',
  phase_stop_edit: '停止并编辑',
  phase_finalizing: '正在完成…',
  phase_running_label: '运行中',
  phase_starting: '正在启动…',
  phase_progress_aria: '整体分析进度',
  phase_complete_aria: '完成',
  phase_error_aria: '错误',

  report_bottom_line: '总结',
  report_expand: '展开',
  report_collapse: '收起',
  report_starting: '正在启动…',
  report_run_again: '再次运行',
  report_download_official: '下载部分预填SAWS-1申请表',
  report_download_worksheet: '下载准备工作表',
  report_draft_disclaimer:
    '州、邮政编码、县和项目复选框已预填。请在提交前检查并填写所有个人信息（姓名、出生日期、社会安全号码、地址）。',

  error_try_again: '重试',
  error_edit_info: '编辑我的信息',
  error_stream_lost: '与分析流的连接已断开。请重试。',
  error_stream_connect_failed: '无法连接到分析流。请重试。',

  lang_select_aria: '选择语言',
  lang_en: 'English',
  lang_es: 'Español',
  lang_zh_CN: '简体中文',
} as const;

export default zhCN;