// screens/HowToUseScreen.tsx
//
// Role-aware "How to Use" onboarding walkthrough.
// Accessible from both Student and Driver/Admin menus via the
// RootStack so users can revisit it at any time.

import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialIcons';

import ScreenContainer from '../components/ScreenContainer';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import type { RootStackParamList } from '../navigation/StackNavigator';

// ─── Types ───────────────────────────────────────────────────────────────────

type HowToUseRoute = RouteProp<RootStackParamList, 'HowToUse'>;

interface Step {
  icon: string;
  title: string;
  body: string;
  color: string;
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const STUDENT_STEPS: Step[] = [
  {
    icon: 'map',
    title: 'Open the Map',
    body: 'When you log in you land on the Map tab. Your campus stops are shown as pins — zoom in or pan to find the one nearest to you.',
    color: '#3B82F6',
  },
  {
    icon: 'place',
    title: 'Tap Your Stop',
    body: 'Tap any stop pin on the map to select it. A callout will appear showing the stop name and a "Request Stop" button.',
    color: '#8B5CF6',
  },
  {
    icon: 'notifications-active',
    title: 'Request a Pickup',
    body: 'Tap "Request Stop" to let the driver know you need a pickup there. Your request is logged instantly — no need to stay on that screen.',
    color: '#F59E0B',
  },
  {
    icon: 'directions-bus',
    title: 'Watch for Your Shuttle',
    body: 'The live shuttle position appears on your map in real time. You\'ll receive a push notification the moment the driver arrives at your stop.',
    color: '#10B981',
  },
  {
    icon: 'check-circle',
    title: 'Board & Go',
    body: 'Board the shuttle when it arrives. The driver will mark you as picked up and your ride will appear in your History once completed.',
    color: '#6366F1',
  },
  {
    icon: 'history',
    title: 'View Past Rides',
    body: 'Tap Menu → History at any time to see a log of all your completed rides, including stops and timestamps.',
    color: '#64748B',
  },
];

const DRIVER_STEPS: Step[] = [
  {
    icon: 'login',
    title: 'Log In & Start Your Shift',
    body: 'Log in with your org credentials. You\'ll land on the Live Location tab — this is your main workspace while driving.',
    color: '#3B82F6',
  },
  {
    icon: 'location-on',
    title: 'Start Sharing Location',
    body: 'Tap "Start Sharing" to broadcast your GPS position. Students and admins can now see where the shuttle is in real time. Always start this before your route begins.',
    color: '#10B981',
  },
  {
    icon: 'list',
    title: 'See Stop Requests',
    body: 'Active stop requests appear as a list below the map. Each card shows the stop name and how many students are waiting. They\'re sorted by your route order.',
    color: '#F59E0B',
  },
  {
    icon: 'near-me',
    title: 'Drive to the Stop',
    body: 'The app tracks your position continuously. When you get within range of a requested stop it highlights automatically — no manual navigation needed.',
    color: '#8B5CF6',
  },
  {
    icon: 'where-to-vote',
    title: 'Mark Arrived & Complete',
    body: 'Tap "Arrived" when you reach the stop. After boarding students, tap "Complete" to close out the request. Students receive a notification for each action.',
    color: '#EF4444',
  },
  {
    icon: 'stop-circle',
    title: 'End Your Shift',
    body: 'When your route is done, tap "Stop Sharing" to turn off location broadcasting. Your completed rides are saved to History automatically.',
    color: '#64748B',
  },
];

const ADMIN_STEPS: Step[] = [
  {
    icon: 'business',
    title: 'Set Up Your Organization',
    body: 'Go to Menu → Org Setup → Stops tab. Add every pickup stop your shuttle serves — give each a clear name and pin it precisely on the map.',
    color: '#3B82F6',
  },
  {
    icon: 'alt-route',
    title: 'Create Routes',
    body: 'In the Stops tab you can group stops into named routes and set their order. Drivers use this to see which stops come next on their run.',
    color: '#8B5CF6',
  },
  {
    icon: 'people',
    title: 'Add Users',
    body: 'Open the Users tab in Org Setup. Invite drivers and students by email. Assign roles — drivers get the Live Location controls, students get the Map view.',
    color: '#10B981',
  },
  {
    icon: 'credit-card',
    title: 'Manage Your Plan',
    body: 'The Billing tab shows your current plan, vehicle limits, and subscription status. Tap "Manage Billing" to update payment info or upgrade your plan.',
    color: '#F59E0B',
  },
  {
    icon: 'bar-chart',
    title: 'Track Analytics',
    body: 'The Analytics tab aggregates boarding counts across all stops and drivers. Use it to find peak demand stops, measure driver activity, and spot patterns.',
    color: '#6366F1',
  },
  {
    icon: 'list-alt',
    title: 'Review Ride Requests',
    body: 'Menu → Requested Rides gives you a real-time admin view of all active and pending stop requests across your organization.',
    color: '#EF4444',
  },
];

const PARENT_STEPS: Step[] = [
  {
    icon: 'phone-iphone',
    title: 'Sign In with Your Phone',
    body: 'Open the app and select your school district. Enter your mobile number and we\'ll send a one-time code to verify it — no password needed.',
    color: '#3B82F6',
  },
  {
    icon: 'map',
    title: 'See the Live Bus Map',
    body: 'Once signed in you\'ll see the map with your child\'s bus stop and the shuttle\'s real-time position. The bus icon moves as the driver reports location.',
    color: '#10B981',
  },
  {
    icon: 'place',
    title: 'Find Your Child\'s Stop',
    body: 'Stop pins are shown on the map. Tap any stop to see its name and how many students are waiting there. Your child\'s regular stop is closest to your address.',
    color: '#8B5CF6',
  },
  {
    icon: 'notifications-active',
    title: 'Get Notified When Bus Arrives',
    body: 'You\'ll receive a push notification the moment the driver marks the bus as arrived at your child\'s stop — so you know exactly when to send them out.',
    color: '#F59E0B',
  },
  {
    icon: 'history',
    title: 'View Past Rides',
    body: 'Tap Menu → History to see a log of all completed pickups, including stop names and timestamps. Useful for confirming your child was picked up on time.',
    color: '#64748B',
  },
];

function stepsForRole(role: RootStackParamList['HowToUse']['role']): Step[] {
  if (role === 'student') return STUDENT_STEPS;
  if (role === 'admin') return ADMIN_STEPS;
  if (role === 'parent') return PARENT_STEPS;
  return DRIVER_STEPS;
}

function titleForRole(role: RootStackParamList['HowToUse']['role']): string {
  if (role === 'student') return 'How to Ride';
  if (role === 'admin') return 'Admin Guide';
  if (role === 'parent') return 'Parent Guide';
  return 'Driver Guide';
}

// ─── Step card ────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function StepCard({ step, index, total }: { step: Step; index: number; total: number }) {
  return (
    <View style={styles.card}>
      <View style={[styles.iconWrap, { backgroundColor: step.color + '1A' }]}>
        <Icon name={step.icon} size={36} color={step.color} />
      </View>

      <View style={styles.stepBadgeRow}>
        <View style={[styles.stepBadge, { backgroundColor: step.color }]}>
          <Text style={styles.stepBadgeText}>
            {index + 1} / {total}
          </Text>
        </View>
      </View>

      <Text style={styles.stepTitle}>{step.title}</Text>
      <Text style={styles.stepBody}>{step.body}</Text>
    </View>
  );
}

// ─── Dot pagination ───────────────────────────────────────────────────────────

function Dots({ count, active }: { count: number; active: number }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, i === active && styles.dotActive]}
        />
      ))}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HowToUseScreen() {
  const navigation = useNavigation();
  const route = useRoute<HowToUseRoute>();
  const { role } = route.params;

  const steps = stepsForRole(role);
  const title = titleForRole(role);

  const [activeIndex, setActiveIndex] = useState(0);
  const [sliderHeight, setSliderHeight] = useState(0);
  const listRef = useRef<FlatList<Step>>(null);

  const goNext = () => {
    if (activeIndex < steps.length - 1) {
      const next = activeIndex + 1;
      listRef.current?.scrollToIndex({ index: next, animated: true });
      setActiveIndex(next);
    } else {
      navigation.goBack();
    }
  };

  const goPrev = () => {
    if (activeIndex > 0) {
      const prev = activeIndex - 1;
      listRef.current?.scrollToIndex({ index: prev, animated: true });
      setActiveIndex(prev);
    }
  };

  return (
    <ScreenContainer style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={24} color={PRIMARY_COLOR} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Slides */}
      <View
        style={styles.sliderWrapper}
        onLayout={(e) => setSliderHeight(e.nativeEvent.layout.height)}
      >
        {sliderHeight > 0 && (
          <FlatList
            ref={listRef}
            data={steps}
            keyExtractor={(_, i) => String(i)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={false}
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH,
              offset: SCREEN_WIDTH * index,
              index,
            })}
            renderItem={({ item, index }) => (
              <View style={{ width: SCREEN_WIDTH, height: sliderHeight, paddingHorizontal: spacing.section }}>
                <StepCard step={item} index={index} total={steps.length} />
              </View>
            )}
            style={styles.slider}
          />
        )}
      </View>

      {/* Dots */}
      <Dots count={steps.length} active={activeIndex} />

      {/* Navigation buttons */}
      <View style={styles.navRow}>
        <TouchableOpacity
          style={[styles.navBtn, styles.navBtnSecondary, activeIndex === 0 && styles.navBtnHidden]}
          onPress={goPrev}
          disabled={activeIndex === 0}
        >
          <Icon name="chevron-left" size={22} color={PRIMARY_COLOR} />
          <Text style={styles.navBtnSecondaryText}>Back</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.navBtn, styles.navBtnPrimary]} onPress={goNext}>
          <Text style={styles.navBtnPrimaryText}>
            {activeIndex === steps.length - 1 ? 'Done' : 'Next'}
          </Text>
          {activeIndex < steps.length - 1 && (
            <Icon name="chevron-right" size={22} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.section,
    paddingVertical: spacing.item,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
  },
  sliderWrapper: {
    flex: 1,
    marginTop: spacing.section,
  },
  slider: {
    flex: 1,
  },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    ...cardShadow,
    marginVertical: 8,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stepBadgeRow: {
    flexDirection: 'row',
  },
  stepBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  stepBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111',
    textAlign: 'center',
  },
  stepBody: {
    fontSize: 15,
    color: '#4b5563',
    textAlign: 'center',
    lineHeight: 22,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.item,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D1D5DB',
  },
  dotActive: {
    backgroundColor: PRIMARY_COLOR,
    width: 20,
    borderRadius: 4,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.section,
    paddingVertical: spacing.section,
    gap: 12,
    paddingBottom: Platform.OS === 'ios' ? spacing.section * 2 : spacing.section,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 4,
  },
  navBtnPrimary: {
    backgroundColor: PRIMARY_COLOR,
    flex: 1,
    justifyContent: 'center',
  },
  navBtnSecondary: {
    backgroundColor: '#F3F4F6',
  },
  navBtnHidden: {
    opacity: 0,
    pointerEvents: 'none',
  },
  navBtnPrimaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
    textAlign: 'center',
    flex: 1,
  },
  navBtnSecondaryText: {
    color: PRIMARY_COLOR,
    fontWeight: '600',
    fontSize: 15,
  },
});
