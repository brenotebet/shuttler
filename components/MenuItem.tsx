// src/components/MenuItem.tsx

import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

export type MenuItemProps = {
  icon: string;
  title: string;
  description: string;
  onPress: () => void;
  variant?: 'default' | 'danger';
};

function MenuItem({
  icon,
  title,
  description,
  onPress,
  variant = 'default',
}: MenuItemProps) {
  const isDanger = variant === 'danger';

  return (
    <TouchableOpacity
      style={styles.item}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Icon
        name={icon}
        size={28}
        color={isDanger ? '#dc2626' : PRIMARY_COLOR}
        style={styles.icon}
      />

      <View style={styles.textContainer}>
        <Text style={[styles.title, isDanger && styles.dangerTitle]}>
          {title}
        </Text>
        <Text style={styles.description}>{description}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(MenuItem);

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.item,
    paddingHorizontal: spacing.section,
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    marginBottom: spacing.section,
    ...cardShadow,
  },
  icon: {
    marginRight: spacing.section,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  dangerTitle: {
    color: '#dc2626',
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
});
