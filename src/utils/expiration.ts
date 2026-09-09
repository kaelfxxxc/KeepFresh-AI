import moment from 'moment-timezone';

export const getExpirationStatus = (expirationDate: string): 'expired' | 'today' | 'expiring_soon' | 'safe' => {
  const now = moment.tz('Asia/Manila');
  const exp = moment(expirationDate);
  
  if (!exp.isValid()) return 'safe';
  
  const startOfDay = moment(now).startOf('day');
  const endOfDay = moment(now).endOf('day');
  const startOfAlert = moment(now).add(1, 'days').startOf('day');
  const endOfAlert = moment(now).add(7, 'days').endOf('day');
  
  if (exp.isBefore(startOfDay)) return 'expired';
  if (exp.isSame(startOfDay, 'day') || exp.isSame(endOfDay, 'day')) return 'today';
  if (exp.isAfter(startOfAlert, 'day') && exp.isBefore(endOfAlert, 'day')) return 'expiring_soon';
  
  return 'safe';
};

export const formatDate = (dateString: string, formatType: 'short' | 'long' | 'calendar' = 'short'): string => {
  const date = moment(dateString);
  if (!date.isValid()) return 'Invalid date';
  
  switch (formatType) {
    case 'short':
      return date.format('DD/MM/YYYY');
    case 'long':
      return date.format('MMMM D, YYYY');
    case 'calendar':
      return date.fromNow();
    default:
      return date.format('DD/MM/YYYY');
  }
};

export const calculateSavings = (originalPrice: number, quantity: number, daysSaved: number): number => {
  const dailySavings = originalPrice / 30;
  return Math.round(dailySavings * daysSaved);
};