import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getCredsystemDashboard } from '../services/credsystemService';
import { toSafeErrorMessage } from '../lib/errorHandling';
import type { Marca, PeriodoFiltro } from '../types/gto';

export function useCredsystemDashboard(filters: {
  marca: Marca | 'Todas';
  periodo: PeriodoFiltro;
}) {
  const query = useQuery({
    queryKey: ['credsystem-dashboard', filters.marca, filters.periodo],
    queryFn: () => getCredsystemDashboard(filters),
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData
  });

  return {
    summary: query.data?.summary ?? null,
    brandMetrics: query.data?.brandMetrics ?? [],
    motivosPropostas: query.data?.motivosPropostas ?? [],
    cards: query.data?.cards ?? [],
    loading: query.isLoading,
    refreshing: query.isFetching && !query.isLoading,
    error: query.isError ? toSafeErrorMessage(query.error, 'Erro ao carregar dados do dashboard.') : null,
    reload: () => query.refetch()
  };
}
