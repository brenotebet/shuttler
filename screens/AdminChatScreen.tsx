// screens/AdminChatScreen.tsx
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialIcons';

import { auth } from '../firebase/firebaseconfig';
import { SHUTTLER_API_URL } from '../config';
import { useOrg } from '../src/org/OrgContext';
import { useOrgTheme } from '../src/org/useOrgTheme';
import ScreenContainer from '../components/ScreenContainer';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED = [
  'Which stop has the most pickups?',
  'How do I add a new driver?',
  'How do I create a new route?',
  'What does my boarding data show?',
];

export default function AdminChatScreen() {
  const navigation = useNavigation();
  const { org } = useOrg();
  const { primaryColor } = useOrgTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<FlatList>(null);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);

    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const token = await auth.currentUser?.getIdToken();
      const apiMessages = next.map((m) => ({ role: m.role, content: m.content }));

      const orgId = org?.orgId;
      if (!orgId) throw new Error('No org');

      const res = await fetch(`${SHUTTLER_API_URL}/ai/admin-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ orgId, messages: apiMessages }),
      });

      const data = await res.json();
      const reply = data.reply ?? 'Sorry, I couldn\'t get a response. Please try again.';

      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: 'assistant', content: reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: 'assistant', content: 'Something went wrong. Please check your connection and try again.' },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages, loading, org?.orgId]);

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
        {!isUser && (
          <View style={[styles.aiBadge, { backgroundColor: primaryColor }]}>
            <Icon name="auto-awesome" size={12} color="#fff" />
          </View>
        )}
        <View style={[
          styles.bubble,
          isUser
            ? [styles.bubbleUser, { backgroundColor: primaryColor }]
            : styles.bubbleAssistant,
        ]}>
          <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant]}>
            {item.content}
          </Text>
        </View>
      </View>
    );
  };

  const isEmpty = messages.length === 0;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScreenContainer style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-back" size={22} color="#374151" />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>AI Assistant</Text>
            <Text style={styles.headerSub} numberOfLines={1}>{org?.name ?? 'Your org'}</Text>
          </View>
          <View style={[styles.aiBadgeLarge, { backgroundColor: primaryColor }]}>
            <Icon name="auto-awesome" size={16} color="#fff" />
          </View>
        </View>

        {/* Messages or empty state */}
        {isEmpty ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: `${primaryColor}15` }]}>
              <Icon name="auto-awesome" size={32} color={primaryColor} />
            </View>
            <Text style={styles.emptyTitle}>Ask me anything</Text>
            <Text style={styles.emptySubtitle}>
              I know your stops, routes, and boarding data. Ask about your operations or how to use the app.
            </Text>
            <View style={styles.suggestions}>
              {SUGGESTED.map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[styles.suggestion, { borderColor: `${primaryColor}40` }]}
                  onPress={() => send(q)}
                >
                  <Text style={[styles.suggestionText, { color: primaryColor }]}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        {/* Thinking indicator */}
        {loading && (
          <View style={styles.thinkingRow}>
            <View style={[styles.aiBadge, { backgroundColor: primaryColor }]}>
              <Icon name="auto-awesome" size={12} color="#fff" />
            </View>
            <View style={styles.thinkingBubble}>
              <ActivityIndicator size="small" color={primaryColor} />
              <Text style={[styles.thinkingText, { color: primaryColor }]}>Thinking…</Text>
            </View>
          </View>
        )}

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask a question…"
            placeholderTextColor="#9ca3af"
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => send(input)}
            blurOnSubmit
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: input.trim() && !loading ? primaryColor : '#e5e7eb' }]}
            onPress={() => send(input)}
            disabled={!input.trim() || loading}
          >
            <Icon name="send" size={18} color={input.trim() && !loading ? '#fff' : '#9ca3af'} />
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 0, paddingTop: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    backgroundColor: '#fff',
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  headerSub: { fontSize: 12, color: '#6b7280', marginTop: 1 },
  aiBadgeLarge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageList: { padding: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end', gap: 8 },
  rowUser: { justifyContent: 'flex-end' },
  rowAssistant: { justifyContent: 'flex-start' },
  aiBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    marginBottom: 2,
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  bubbleUser: { borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: '#f3f4f6', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  bubbleTextUser: { color: '#fff' },
  bubbleTextAssistant: { color: '#111827' },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  thinkingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
  },
  thinkingText: { fontSize: 13, fontWeight: '500' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    backgroundColor: '#fff',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 28,
    maxWidth: 300,
  },
  suggestions: { gap: 10, width: '100%' },
  suggestion: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  suggestionText: { fontSize: 14, fontWeight: '500' },
});
