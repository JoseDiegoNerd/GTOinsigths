import { useQuery } from '@tanstack/react-query';
import { toSafeErrorMessage } from '../lib/errorHandling';
import { listBandeirasComContagem } from '../services/bandeirasService';

export function useBandeiras() {
  const query = useQuery({
    queryKey: ['bandeiras-contagem'],
    queryFn: listBandeirasComContagem,
    staleTime: 1000 * 60
  });

  return {
    bandeiras: query.data ?? [],
    loading: query.isLoading,
    error: query.isError ? toSafeErrorMessage(query.error, 'Não foi possível carregar as bandeiras agora.') : null,
    reload: () => query.refetch()
  };
}
