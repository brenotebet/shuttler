import { useOrg } from './OrgContext';
import { PRIMARY_COLOR } from '../constants/theme';

export function useOrgTheme() {
  const { org } = useOrg();
  return {
    primaryColor: org?.primaryColor ?? PRIMARY_COLOR,
  };
}
