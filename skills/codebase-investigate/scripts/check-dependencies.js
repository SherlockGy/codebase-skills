#!/usr/bin/env node

/**
 * check-dependencies.js
 *
 * PreToolUse hook 脚本：在写入调查报告前进行两项检查：
 * 1. 模式确认检查 - 确保用户已确认分析模式
 * 2. 依赖文件检查 - 确保前序阶段的报告已生成
 *
 * 退出码规范（官方文档）：
 * - 0: 成功，允许操作继续
 * - 2: 阻止错误，工具执行被阻止，stderr 反馈给 Claude
 * - 其他: 非阻止错误，仅显示错误，执行继续
 *
 * 用法：node check-dependencies.js "<tool_input_json>"
 */

const fs = require('fs');
const path = require('path');

// 配置
const INVESTIGATION_DIR = '.claude/investigation';
const CONFIRMED_FILE = path.join(INVESTIGATION_DIR, 'mode-confirmed.json');

// 文件依赖关系定义
const FILE_DEPENDENCIES = {
  'scan-report.md': [],                                    // 扫描报告无前置依赖
  'trace-report.md': ['scan-report.md'],                   // 追踪报告依赖扫描报告
  'conclusion.md': ['scan-report.md', 'trace-report.md']   // 结论依赖扫描和追踪报告
};

/**
 * 从 tool_input JSON 中提取目标文件路径
 */
function extractTargetFile(toolInputJson) {
  try {
    const input = JSON.parse(toolInputJson);
    return input.file_path || null;
  } catch (e) {
    return null;
  }
}

/**
 * 判断是否是调查报告文件
 */
function isInvestigationReport(filePath) {
  if (!filePath) return false;

  // 支持多种路径格式
  const normalizedPath = filePath.replace(/\\/g, '/');
  const reportPattern = /investigation\/(scan-report|trace-report|conclusion)\.md$/;

  return reportPattern.test(normalizedPath);
}

/**
 * 获取目标文件的文件名
 */
function getReportFilename(filePath) {
  return path.basename(filePath);
}

/**
 * 检查模式确认文件
 * @returns {object} { valid: boolean, error: string|null }
 */
function checkModeConfirmed() {
  const confirmedPath = path.resolve(process.cwd(), CONFIRMED_FILE);

  // 检查文件是否存在
  if (!fs.existsSync(confirmedPath)) {
    return {
      valid: false,
      error: `未找到模式确认文件 (${CONFIRMED_FILE})

在执行代码库调查前，必须先确认分析模式。

请在 /codebase-investigate 中：
1. 等待 AI 提供分析模式建议
2. 确认选择「简单查询」或「标准调查」
3. AI 会自动创建确认文件

然后才能继续执行扫描/追踪/结论阶段。`
    };
  }

  // 验证文件内容
  try {
    const content = fs.readFileSync(confirmedPath, 'utf8');
    const confirmed = JSON.parse(content);

    if (!confirmed.user_confirmed) {
      return {
        valid: false,
        error: `模式确认未完成

确认文件存在但 user_confirmed 字段为 false。
请先在 /codebase-investigate 中完成模式确认。`
      };
    }

    if (!confirmed.mode || !['simple', 'standard'].includes(confirmed.mode)) {
      return {
        valid: false,
        error: `模式确认文件格式错误

mode 字段必须是 "simple" 或 "standard"。`
      };
    }

    return { valid: true, error: null, mode: confirmed.mode };

  } catch (e) {
    if (e instanceof SyntaxError) {
      return {
        valid: false,
        error: `模式确认文件 JSON 格式错误: ${e.message}`
      };
    }
    return {
      valid: false,
      error: `读取模式确认文件失败: ${e.message}`
    };
  }
}

/**
 * 检查依赖文件是否存在
 * @param {string} targetFilename - 目标文件名 (如 'trace-report.md')
 * @returns {object} { valid: boolean, missing: string[] }
 */
function checkFileDependencies(targetFilename) {
  const dependencies = FILE_DEPENDENCIES[targetFilename];

  if (!dependencies || dependencies.length === 0) {
    return { valid: true, missing: [] };
  }

  const missing = [];
  for (const dep of dependencies) {
    const depPath = path.resolve(process.cwd(), INVESTIGATION_DIR, dep);
    if (!fs.existsSync(depPath)) {
      missing.push(dep);
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * 主函数
 */
function main() {
  const toolInputJson = process.argv[2];

  if (!toolInputJson) {
    console.error('Usage: node check-dependencies.js "<tool_input_json>"');
    process.exit(1); // 用法错误，非阻止
  }

  // 提取目标文件
  const targetFile = extractTargetFile(toolInputJson);

  // 如果不是调查报告文件，直接放行
  if (!isInvestigationReport(targetFile)) {
    process.exit(0);
  }

  const targetFilename = getReportFilename(targetFile);
  console.log(`[依赖检查] 目标文件: ${targetFilename}`);

  // 检查 1：模式确认
  const modeCheck = checkModeConfirmed();
  if (!modeCheck.valid) {
    console.error(`\n❌ 阻止操作：${modeCheck.error}\n`);
    process.exit(2); // 使用 exit(2) 阻止操作
  }
  console.log(`✓ 模式已确认: ${modeCheck.mode}`);

  // 检查 2：依赖文件
  const depCheck = checkFileDependencies(targetFilename);
  if (!depCheck.valid) {
    console.error(`\n❌ 阻止操作：缺少前置文件\n`);
    console.error(`在写入 ${targetFilename} 前，必须先完成以下阶段：`);
    depCheck.missing.forEach(dep => {
      console.error(`  - ${dep} (不存在)`);
    });
    console.error(`\n请按顺序执行：scan → trace → conclude\n`);
    process.exit(2); // 使用 exit(2) 阻止操作
  }

  if (FILE_DEPENDENCIES[targetFilename]?.length > 0) {
    console.log(`✓ 依赖文件检查通过: ${FILE_DEPENDENCIES[targetFilename].join(', ')}`);
  }

  // 所有检查通过
  console.log(`✓ 允许写入: ${targetFilename}`);
  process.exit(0);
}

main();
