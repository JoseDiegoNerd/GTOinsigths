import { useCallback, useEffect, useState } from 'react';
import { getCredsystemDashboard } from '../services/credsystemService';
import type { BrandMetric, DashboardSummary, DadosCartoesCredsystem, Marca, MotivoPropostaMetric, PeriodoFiltro } from '../types/gto';

type DashboardState = {
  summary: DashboardSummary | null;
  brandMetrics: BrandMetric[];
  motivosPropostas: MotivoPropostaMetric[];
  cards: DadosCartoesCredsystem[];
};

export function useCredsystemDashboard(filters: {
  marca: Marca | 'Todas';
  periodo: PeriodoFiltro;
}) {
  const [data, setData] = useState<DashboardState>({
    summary: null,
    brandMetrics: [],
    motivosPropostas: [],
    cards: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextData = await getCredsystemDashboard(filters);
      setData(nextData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados do Supabase.');
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
