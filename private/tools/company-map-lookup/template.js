'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CompanyMapTemplate = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FILE_NAME = '公司地图地址查询模板.xlsx';
  const COMPANY_SHEET = '公司名单';
  const GUIDE_SHEET = '填写说明';
  const HEADERS = ['公司名称', '城市/地区（可选）'];
  const GUIDE_LINES = [
    '「公司名称」为必填字段。',
    '一行填写一家公司。',
    '不要合并单元格。',
    '「城市/地区」为可选字段。',
    '如果知道公司所在城市，建议填写，可以提高地图匹配准确率。',
    '不知道城市时可以留空，高德地图 Provider 可以进行全国搜索。',
    '百度地图 Provider 查询时通常需要地区信息，因此使用百度时建议填写城市/地区。',
    '不要在 Excel 中填写地图 API Key。',
    'API Key 必须在网页中输入。',
    '上传模板不会修改你的原始 Excel。',
    '查询结果会单独导出。'
  ];

  function buildWorkbook(XLSX) {
    if (!XLSX || !XLSX.utils || typeof XLSX.utils.book_new !== 'function') {
      throw new Error('Excel 组件未加载，无法生成模板。');
    }

    const workbook = XLSX.utils.book_new();

    const companySheet = XLSX.utils.aoa_to_sheet([HEADERS]);
    companySheet['!cols'] = [{ wch: 36 }, { wch: 22 }];
    companySheet['!autofilter'] = { ref: 'A1:B1' };
    XLSX.utils.book_append_sheet(workbook, companySheet, COMPANY_SHEET);

    const guideRows = [
      ['公司地图地址查询模板 · 填写说明'],
      [''],
      ...GUIDE_LINES.map((line, index) => [`${index + 1}. ${line}`])
    ];
    const guideSheet = XLSX.utils.aoa_to_sheet(guideRows);
    guideSheet['!cols'] = [{ wch: 96 }];
    XLSX.utils.book_append_sheet(workbook, guideSheet, GUIDE_SHEET);

    return workbook;
  }

  return {
    FILE_NAME,
    COMPANY_SHEET,
    GUIDE_SHEET,
    HEADERS,
    GUIDE_LINES,
    buildWorkbook
  };
});
