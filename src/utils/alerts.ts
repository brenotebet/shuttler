import { showToast, ToastType } from '../components/Toast';

type AlertType = 'success' | 'error' | 'info';

function inferType(title: string): AlertType {
  const t = title.toLowerCase();
  if (t.includes('error') || t.includes('fail') || t.includes('invalid') || t.includes('denied')) return 'error';
  if (t.includes('saved') || t.includes('success') || t.includes('sent') || t.includes('approved') || t.includes('done')) return 'success';
  return 'info';
}

export function showAlert(message: string, title = 'Shuttler', type?: AlertType) {
  const resolved: ToastType = type ?? inferType(title);
  const text = title && title !== 'Shuttler' ? `${title}: ${message}` : message;
  showToast(text, resolved);
}
