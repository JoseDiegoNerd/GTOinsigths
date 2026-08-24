import { useState } from 'react';
import {
  buildImportPreview,
  importRowsToStage,
  parseCsvFile
} from '../services/importService';
import { toSafeErrorMessage } from '../lib/errorHandling';
import type { ImportPreview, Marca, StageSource } from '../types/gto';

// accept=".csv" no <input> e so dica de UI (nao impede selecionar/arrastar outro arquivo) - esta
// checagem em JS que de fato barra formato/tamanho antes de gastar tempo lendo o arquivo.
const EXTENSAO_PERMITIDA = '.csv';
const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10MB

export function useStageImport() {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function prepareFile(file: File, source: StageSource, marca: Marca) {
    setLoading(true);
    setError(null);
    setResult(null);

    if (!file.name.toLowerCase().endsWith(EXTENSAO_PERMITIDA)) {
      setError(`Formato não suportado. Envie um arquivo ${EXTENSAO_PERMITIDA}.`);
      setLoading(false);
      return;
    }
    if (file.size > TAMANHO_MAXIMO_BYTES) {
      setError(`Arquivo muito grande (${(file.size / (1024 * 1024)).toFixed(1)}MB). O limite é ${TAMANHO_MAXIMO_BYTES / (1024 * 1024)}MB.`);
      setLoading(false);
      return;
    }

    try {
      const parsed = await parseCsvFile(file);
      setParsedRows(parsed.rows);
      setPreview(buildImportPreview(file.name, source, marca, parsed));
    } catch (err) {
      setError(toSafeErrorMessage(err, 'Erro ao ler arquivo. Verifique o formato do CSV.'));
    } finally {
      setLoading(false);
    }
  }

  async function importPreparedRows() {
    if (!preview) return;
    if (preview.errors.length > 0) {
      setError('Corrija os erros de validação antes de importar.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const importResult = await importRowsToStage({
        source: preview.source,
        marca: preview.marca,
        rows: parsedRows,
        fileName: preview.fileName
      });
      setResult(`${importResult.insertedRows} linhas importadas em ${importResult.table}.`);
    } catch (err) {
      setError(toSafeErrorMessage(err, 'Erro ao importar dados. Verifique os dados e tente novamente.'));
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setPreview(null);
    setParsedRows([]);
    setResult(null);
    setError(null);
  }

  return {
    preview,
    loading,
    result,
    error,
    prepareFile,
    importPreparedRows,
    reset
  };
}
