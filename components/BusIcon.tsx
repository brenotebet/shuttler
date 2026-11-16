import React from 'react';
import { View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

type Props = {
  /** Body color — the bus's route color, or the org color. */
  color: string;
  /** Degrees clockwise from north; the bus's front points this way. */
  heading: number;
  /** Rendered length of the bus in points (width is half). */
  size?: number;
};

const WINDOW = '#1f2937';

/**
 * Top-down bus for the live map, front pointing up before rotation.
 * A white outline keeps it readable on top of its own (same-colored) route
 * line, and a soft centered shadow lifts it off the map without depending on
 * which way the bus is facing.
 */
function BusIcon({ color, heading, size = 36 }: Props) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: `${heading}deg` }] }}>
      <Svg width={size / 2 + 4} height={size + 4} viewBox="-2 -2 24 44">
        {/* Soft shadow: two faint, slightly larger shapes under the body. */}
        <Rect x={0} y={0.5} width={20} height={40} rx={6} fill="#000" opacity={0.08} />
        <Rect x={0.8} y={1.2} width={18.4} height={38.4} rx={5.5} fill="#000" opacity={0.1} />
        {/* Side mirrors */}
        <Rect x={0.4} y={7} width={2} height={3} rx={1} fill={WINDOW} opacity={0.75} />
        <Rect x={17.6} y={7} width={2} height={3} rx={1} fill={WINDOW} opacity={0.75} />
        {/* Body */}
        <Rect x={2} y={2} width={16} height={36} rx={4.5} fill={color} stroke="#fff" strokeWidth={1.5} />
        {/* Windshield */}
        <Rect x={4} y={5} width={12} height={6} rx={2} fill={WINDOW} opacity={0.85} />
        {/* Roof highlight */}
        <Rect x={5.5} y={14} width={9} height={18} rx={2} fill="#fff" opacity={0.2} />
        {/* Rear window */}
        <Rect x={5} y={34.5} width={10} height={1.6} rx={0.8} fill={WINDOW} opacity={0.6} />
      </Svg>
    </View>
  );
}

export default React.memo(BusIcon);
