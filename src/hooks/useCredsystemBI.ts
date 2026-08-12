import { useCallback, useEffect, useState } from 'react';
import { getCredsystemBI } from '../services/credsystemService';
import { toSafeErrorMessage } from '../lib/errorHandling';
import type { CredsystemBI, Marca } from '../types/gto';

const emptyBI: CredsystemBI = {
  resumo: [],
  porMarca: [],
  lojas: [],
  motivos: [],
  funil: []
};

export function useCredsystemBI(filters: {
  marca: Marca | 'Todas';
}) {
  const [data, setData] = useState<CredsystemBI>(emptyBI);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getCredsystemBI(filters));
    } catch (err) {
      setError(toSafeErrorMessage(err, 'Erro ao carregar views BI do CredSystem.'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    reload();
  }, [reload]);

  return {
    ...data,
    loading,
    error,
    reload
  };
}
