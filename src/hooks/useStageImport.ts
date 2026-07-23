import { useState } from 'react';
import {
  buildImportPreview,
  importRowsToStage,
  parseCsvFile
} from '../services/importService';
import type { ImportPreview, Marca, StageSource } from '../types/gto';

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
    try {
      const parsed = await parseCsvFile(file);
      setParsedRows(parsed.rows);
      setPreview(buildImportPreview(file.name, source, marca, parsed));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao ler arquivo.');
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
      setError(err instanceof Error ? err.message : 'Erro ao importar dados.');
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
