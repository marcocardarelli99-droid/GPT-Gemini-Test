import { useState, useRef, useEffect, useCallback } from 'react';

// The Web Speech API is still prefixed in some browsers
// @ts-ignore
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export const useSpeechRecognition = () => {
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  
  const finalTranscriptRef = useRef('');
  const recognitionRef = useRef<any>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognition) {
      console.error('Speech Recognition API not supported in this browser.');
      return;
    }
    if (isListening) return;

    const recognition = new (SpeechRecognition as any)();
    recognitionRef.current = recognition;

    // Critical configuration from the guide
    recognition.continuous = True;
    recognition.interimResults = True;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let interimText = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          finalText += text;
        } else {
          interimText += text;
        }
      }

      if (finalText) {
        finalTranscriptRef.current += finalText + ' ';
        setTranscript(finalTranscriptRef.current);
      }
      setInterimTranscript(interimText);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
    };

    // Auto-restart logic from the guide
    recognition.onend = () => {
      setIsListening(false);
      if (mountedRef.current) {
        console.log('Speech recognition ended. Auto-restarting is handled by the main component logic.');
      }
    };
    
    recognition.start();
    setIsListening(true);
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    finalTranscriptRef.current = '';
    setTranscript('');
    setInterimTranscript('');
    setIsListening(false);
  }, []);

  return {
    transcript,
    interimTranscript,
    isListening,
    startListening,
    stopListening,
  };
};
