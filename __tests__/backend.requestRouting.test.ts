// __tests__/backend.requestRouting.test.ts
import { shouldNotifyOfStopRequest } from '../backend/requestRouting';

describe('shouldNotifyOfStopRequest', () => {
  it('always notifies admins and never riders', () => {
    expect(shouldNotifyOfStopRequest('admin', 'rental', { online: true, routeId: 'terminal' })).toBe(true);
    expect(shouldNotifyOfStopRequest('student', 'rental', undefined)).toBe(false);
  });

  it('notifies a driver online on the request route', () => {
    expect(shouldNotifyOfStopRequest('driver', 'rental', { online: true, routeId: 'rental' })).toBe(true);
  });

  it('skips a driver online on a different route', () => {
    expect(shouldNotifyOfStopRequest('driver', 'rental', { online: true, routeId: 'terminal' })).toBe(false);
  });

  it('keeps notifying offline drivers, route-less buses and route-less requests', () => {
    expect(shouldNotifyOfStopRequest('driver', 'rental', { online: false, routeId: 'terminal' })).toBe(true);
    expect(shouldNotifyOfStopRequest('driver', 'rental', undefined)).toBe(true);
    expect(shouldNotifyOfStopRequest('driver', 'rental', { online: true, routeId: null })).toBe(true);
    expect(shouldNotifyOfStopRequest('driver', null, { online: true, routeId: 'terminal' })).toBe(true);
  });
});
