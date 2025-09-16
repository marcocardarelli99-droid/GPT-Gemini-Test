import React from 'react';
import VoiceAssistant from './components/VoiceAssistant';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Gemini Live TTS Assistant</h1>
        <p>Real-time, interruptible voice conversations.</p>
      </header>
      <main>
        <VoiceAssistant />
      </main>
    </div>
  );
}

export default App;
