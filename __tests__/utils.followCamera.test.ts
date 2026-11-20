import {
  cameraFollowTarget,
  cameraModeAfterBusCardClosed,
  followAnimationMs,
  FOLLOW_RETARGET_MS,
} from '../src/utils/followCamera';

describe('cameraFollowTarget', () => {
  const base = { selectedBusId: null, rideActive: false, rideBusId: null };

  it('follows the tapped bus while its card is open', () => {
    expect(cameraFollowTarget({ ...base, mode: 'followBus', selectedBusId: 'bus1' }))
      .toEqual({ kind: 'bus', busId: 'bus1' });
  });

  it('follows the tapped bus over the ride bus during a ride', () => {
    expect(cameraFollowTarget({
      mode: 'followBus', selectedBusId: 'bus2', rideActive: true, rideBusId: 'bus1',
    })).toEqual({ kind: 'bus', busId: 'bus2' });
  });

  it('follows the ride bus during a ride', () => {
    expect(cameraFollowTarget({ ...base, mode: 'followRide', rideActive: true, rideBusId: 'bus1' }))
      .toEqual({ kind: 'ride', busId: 'bus1' });
  });

  it('pauses ride following while a bus card is opening', () => {
    expect(cameraFollowTarget({
      mode: 'followRide', selectedBusId: 'bus2', rideActive: true, rideBusId: 'bus1',
    })).toBeNull();
  });

  it('follows nothing once the ride is over or has no bus yet', () => {
    expect(cameraFollowTarget({ ...base, mode: 'followRide', rideBusId: 'bus1' })).toBeNull();
    expect(cameraFollowTarget({ ...base, mode: 'followRide', rideActive: true })).toBeNull();
  });

  it('follows nothing after the rider moves the map', () => {
    expect(cameraFollowTarget({ ...base, mode: 'free', rideActive: true, rideBusId: 'bus1' })).toBeNull();
    expect(cameraFollowTarget({ ...base, mode: 'followUser' })).toBeNull();
    expect(cameraFollowTarget({ ...base, mode: 'overview' })).toBeNull();
  });

  it('follows nothing when the followed bus card has no bus', () => {
    expect(cameraFollowTarget({ ...base, mode: 'followBus' })).toBeNull();
  });
});

describe('cameraModeAfterBusCardClosed', () => {
  it('goes back to following the ride during a ride', () => {
    expect(cameraModeAfterBusCardClosed('followBus', true)).toBe('followRide');
  });

  it('leaves the camera where it is with no ride', () => {
    expect(cameraModeAfterBusCardClosed('followBus', false)).toBe('free');
  });

  it('keeps any other mode', () => {
    expect(cameraModeAfterBusCardClosed('free', true)).toBe('free');
    expect(cameraModeAfterBusCardClosed('followRide', true)).toBe('followRide');
  });
});

describe('followAnimationMs', () => {
  it('matches the marker glide', () => {
    expect(followAnimationMs(4000)).toBe(4000);
  });

  it('catches up quickly after a jump or with no glide known', () => {
    expect(followAnimationMs(0)).toBe(FOLLOW_RETARGET_MS);
    expect(followAnimationMs(undefined)).toBe(FOLLOW_RETARGET_MS);
  });

  it('clamps very short and very long glides', () => {
    expect(followAnimationMs(100)).toBe(FOLLOW_RETARGET_MS);
    expect(followAnimationMs(60_000)).toBe(6000);
  });
});
