import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenerativeAI, Modality, GenerativeModel } from '@google/genai';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

// Define a type for our audio source tracking
type AudioNodePair = { source: AudioBufferSourceNode; gainNode: GainNode };

const voices = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Leda', 'Orus', 'Puck', 'Zephyr'];

const VoiceAssistant: React.FC = () => {
    const [status, setStatus] = useState('Disconnected');
    const [sessionActive, setSessionActive] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [selectedVoice, setSelectedVoice] = useState('Aoede');
    const [conversationTranscript, setConversationTranscript] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);

    const { transcript, interimTranscript, isListening, startListening, stopListening } = useSpeechRecognition();
    
    // Refs for all the Web Audio API and Gemini bits
    const clientRef = useRef<GoogleGenerativeAI | null>(null);
    const sessionRef = useRef<any>(null); // Using 'any' as the type is complex
    const audioContextRef = useRef<AudioContext | null>(null);
    const outputContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const sourcesRef = useRef<Set<AudioNodePair>>(new Set());
    const nextStartTimeRef = useRef(0);
    const geminiAudioChunksRef = useRef<string[]>([]);
    
    // Effect to initialize the Gemini client
    useEffect(() => {
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (!apiKey) {
            setStatus('API Key not found');
            console.error("VITE_GEMINI_API_KEY is not set in your environment.");
            return;
        }
        clientRef.current = new GoogleGenerativeAI(apiKey);
    }, []);
    
    // Effect to add user's final speech to the transcript
    useEffect(() => {
      if (transcript.trim()) {
        setConversationTranscript(prev => {
          const newTranscript = [...prev];
          const lastEntry = newTranscript[newTranscript.length - 1];
          if (lastEntry && lastEntry.role === 'user') {
            lastEntry.text = transcript.trim();
          } else {
            newTranscript.push({ role: 'user', text: transcript.trim() });
          }
          return newTranscript;
        });
      }
    }, [transcript]);

    const handleGeminiMessage = async (message: any) => {
        if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                    geminiAudioChunksRef.current.push(part.inlineData.data);
                    const base64 = part.inlineData.data;
                    const byteArray = new Uint8Array(atob(base64).split('').map(c => c.charCodeAt(0)));
                    const int16Array = new Int16Array(byteArray.buffer);
                    const float32 = new Float32Array(int16Array.length);
                    for (let i = 0; i < int16Array.length; i++) {
                        float32[i] = int16Array[i] / 32768.0;
                    }
                    playAudioData(float32);
                }
                if (part.text) {
                    setConversationTranscript(prev => [...prev, { role: 'ai', text: part.text }]);
                }
            }
        }
        
        // Handle graceful interrupts
        if (message.serverContent?.interrupted) {
            if (!outputContextRef.current) return;
            const currentTime = outputContextRef.current.currentTime;
            const fadeOutDuration = 0.03; // 30ms fadeout
            Array.from(sourcesRef.current).forEach(({ source, gainNode }) => {
                gainNode.gain.setValueAtTime(gainNode.gain.value, currentTime);
                gainNode.gain.linearRampToValueAtTime(0, currentTime + fadeOutDuration);
                source.stop(currentTime + fadeOutDuration);
            });
            sourcesRef.current.clear();
            nextStartTimeRef.current = 0;
        }
    };

    const initSession = async () => {
        if (!clientRef.current) return;
        setStatus('Connecting...');
        try {
            const session = await clientRef.current.getGenerativeModel({model: "models/gemini-1.5-flash-latest"}).startChat({
                history: []
            })
            const live_session = await (session as any)._startLiveSession({
                 model: 'gemini-live-2.5-flash-preview',
                 callbacks: {
                     onopen: () => {
                         console.log('Session opened successfully');
                         setSessionActive(true);
                         setStatus('Connected');
                         startRecording();
                     },
                     onmessage: handleGeminiMessage,
                     onerror: (e: any) => {
                         console.error('Session error:', e);
                         setStatus('Connection error');
                         reset();
                     },
                     onclose: (e: any) => {
                         console.log('Session closed:', e?.reason);
                         setSessionActive(false);
                         setStatus('Disconnected');
                     }
                 },
                 config: {
                     responseModalities: [Modality.AUDIO],
                     speechConfig: {
                         voiceConfig: {
                             prebuiltVoiceConfig: { voiceName: selectedVoice }
                         }
                     },
                     systemInstruction: {
                         parts: [{ text: "You are a helpful and friendly voice assistant. Keep your responses concise and to the point." }]
                     }
                 }
            });
            sessionRef.current = live_session;
        } catch (error) {
            console.error("Failed to initialize session:", error);
            setStatus('Connection failed');
        }
    };

    const playAudioData = async (float32Array: Float32Array) => {
        if (!outputContextRef.current) {
            outputContextRef.current = new AudioContext({ sampleRate: 24000 });
        }
        if (outputContextRef.current.state === 'suspended') {
            await outputContextRef.current.resume();
        }
        const audioBuffer = outputContextRef.current.createBuffer(1, float32Array.length, 24000);
        audioBuffer.getChannelData(0).set(float32Array);
        
        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputContextRef.current.currentTime);
        
        const source = outputContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        
        const gainNode = outputContextRef.current.createGain();
        gainNode.gain.value = 1.0;
        
        source.connect(gainNode);
        gainNode.connect(outputContextRef.current.destination);
        
        const audioNodePair = { source, gainNode };
        sourcesRef.current.add(audioNodePair);
        
        source.addEventListener('ended', () => {
            sourcesRef.current.delete(audioNodePair);
        });
        
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += audioBuffer.duration;
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            
            audioContextRef.current = new AudioContext({ sampleRate: 16000 });
            sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
            processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

            processorRef.current.onaudioprocess = (e) => {
                const float32 = e.inputBuffer.getChannelData(0);
                const int16 = new Int16Array(float32.length);
                for (let i = 0; i < float32.length; i++) {
                    int16[i] = float32[i] * 32768;
                }
                const base64 = btoa(String.fromCharCode(...Array.from(new Uint8Array(int16.buffer))));
                
                if (sessionRef.current?.sendRealtimeInput) {
                    sessionRef.current.sendRealtimeInput({ media: { data: base64, mimeType: "audio/pcm;rate=16000" } });
                }
            };

            sourceRef.current.connect(processorRef.current);
            processorRef.current.connect(audioContextRef.current.destination);
            
            setIsRecording(true);
            startListening();

        } catch (error) {
            console.error('Error starting recording:', error);
            setStatus('Microphone access denied');
        }
    };
    
    const stopRecording = () => {
        stopListening();
        setIsRecording(false);
        streamRef.current?.getTracks().forEach(track => track.stop());
        processorRef.current?.disconnect();
        sourceRef.current?.disconnect();
        audioContextRef.current?.close().catch(console.error);
    };

    const reset = () => {
        stopRecording();
        if (sessionRef.current) {
            sessionRef.current.close();
            sessionRef.current = null;
        }
        outputContextRef.current?.close().catch(console.error);
        sourcesRef.current.forEach(({ source }) => source.stop());
        sourcesRef.current.clear();
        setSessionActive(false);
        setStatus('Disconnected');
        setConversationTranscript([]);
    };

    const handleToggleSession = () => {
        if (sessionActive) {
            reset();
        } else {
            initSession();
        }
    };

    return (
        <div className="voice-assistant">
            <div className="status-bar">
                Status: <span className={`status ${status.split(' ')[0]}`}>{status}</span>
            </div>
            <div className="controls">
                <select 
                    className="voice-select"
                    value={selectedVoice} 
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    disabled={sessionActive}
                >
                    {voices.map(voice => <option key={voice} value={voice}>{voice}</option>)}
                </select>
                <button 
                    onClick={handleToggleSession} 
                    className={`action-button ${sessionActive ? 'stop' : 'start'}`}
                    disabled={status === 'Connecting...' || !clientRef.current}
                >
                    {sessionActive ? 'Stop Session' : 'Start Session'}
                </button>
            </div>
            <div className="transcript-container">
                {conversationTranscript.map((entry, index) => (
                    <div key={index} className={`transcript-entry ${entry.role}`}>
                        <strong>{entry.role === 'ai' ? 'Gemini' : 'You'}:</strong>
                        <p>{entry.text}</p>
                    </div>
                ))}
                 {interimTranscript && (
                    <div className="transcript-entry user">
                        <strong>You:</strong>
                        <p className="interim">{interimTranscript}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VoiceAssistant;
