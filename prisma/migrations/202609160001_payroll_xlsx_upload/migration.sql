UPDATE "DataSource"
SET
  "key" = 'payroll-xlsx-upload',
  "name" = 'Начисления ФОТ из загружаемых XLSX',
  "type" = 'UPLOADED_XLSX',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'local-payroll-xlsx';
