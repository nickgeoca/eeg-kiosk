'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import throttle from 'lodash.throttle';

interface EegBatchData {
  channels: number[][];
  timestamp: number;
}

interface Sample {
  timestamp: number;
  value: number;
}

const SAMPLE_RATE = 250;
const WINDOW_DURATION = 2000;
const WINDOW_SIZE = Math.ceil((SAMPLE_RATE * WINDOW_DURATION) / 1000);
const GRAPH_HEIGHT = 100;
const GRAPH_WIDTH = 400;
const CHANNEL_COLORS = ['#2196f3', '#4caf50', '#f44336', '#9c27b0'];

const VOLTAGE_TICKS = [-1.5, -0.75, 0, 0.75, 1.5];
const TIME_TICKS = [0, 0.5, 1.0, 1.5, 2.0];

class RingBuffer {
  private buffer: Sample[];
  private pointer: number = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity).fill({ timestamp: 0, value: 0 });
  }

  push(sample: Sample) {
    this.buffer[this.pointer] = sample;
    this.pointer = (this.pointer + 1) % this.capacity;
  }

  getArray(): Sample[] {
    return [...this.buffer.slice(this.pointer), ...this.buffer.slice(0, this.pointer)];
  }
}

export default function EegMonitorCanvas() {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([null, null, null, null]);
  const dataRef = useRef<RingBuffer[]>(
    Array(4).fill(null).map(() => new RingBuffer(WINDOW_SIZE))
  );
  const [status, setStatus] = useState('Connecting...');
  const lastTimestampRef = useRef<number>(Date.now());
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));

  const yScale = useMemo(() => {
    const scale = (value: number) => {
      const min = -1.5;
      const max = 1.5;
      return GRAPH_HEIGHT - ((value - min) / (max - min) * GRAPH_HEIGHT);
    };
    return scale;
  }, []);

  // Create background pattern once
  useEffect(() => {
    const bgCanvas = backgroundCanvasRef.current;
    bgCanvas.width = GRAPH_WIDTH;
    bgCanvas.height = GRAPH_HEIGHT;
    const bgCtx = bgCanvas.getContext('2d', { alpha: false });
    if (!bgCtx) return;

    // Simple background
    bgCtx.fillStyle = '#ffffff';
    bgCtx.fillRect(0, 0, GRAPH_WIDTH, GRAPH_HEIGHT);
    
    // Grid
    bgCtx.strokeStyle = 'rgba(240, 240, 240, 0.8)';
    bgCtx.lineWidth = 0.5;

    // Vertical time lines
    TIME_TICKS.forEach(time => {
      const x = GRAPH_WIDTH - (time * GRAPH_WIDTH / (WINDOW_DURATION / 1000));
      bgCtx.beginPath();
      bgCtx.moveTo(x, 0);
      bgCtx.lineTo(x, GRAPH_HEIGHT);
      bgCtx.stroke();
    });

    // Horizontal voltage lines
    VOLTAGE_TICKS.forEach(voltage => {
      const y = yScale(voltage);
      bgCtx.beginPath();
      bgCtx.moveTo(0, y);
      bgCtx.lineTo(GRAPH_WIDTH, y);
      bgCtx.stroke();
    });
  }, []);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080/eeg');
    
    ws.onopen = () => setStatus('Connected');

    const handleMessage = throttle((event: MessageEvent) => {
      try {
        const data: EegBatchData = JSON.parse(event.data);
        const sampleInterval = 1000 / SAMPLE_RATE;
        lastTimestampRef.current = Date.now();

        data.channels.forEach((channel, channelIndex) => {
          channel.forEach((value, i) => {
            const timestamp = data.timestamp + (i * sampleInterval);
            dataRef.current[channelIndex].push({ 
              timestamp, 
              value: value  // Direct use of raw value
            });
          });
        });
      } catch (error) {
        console.error('WebSocket error:', error);
      }
    }, 32);

    ws.onmessage = handleMessage;

    const draw = () => {
      const now = Date.now();
      const startTime = now - WINDOW_DURATION;

      dataRef.current.forEach((buffer, channelIndex) => {
        const ctx = canvasRefs.current[channelIndex]?.getContext('2d', {
          alpha: false,
          desynchronized: true
        });
        if (!ctx) return;

        // Copy background
        ctx.drawImage(backgroundCanvasRef.current, 0, 0);

        const samples = buffer.getArray()
          .filter(s => s.timestamp >= startTime && s.timestamp <= now)
          .sort((a, b) => a.timestamp - b.timestamp);

        if (samples.length >= 2) {
          // Simple line drawing without effects
          ctx.beginPath();
          ctx.strokeStyle = CHANNEL_COLORS[channelIndex];
          ctx.lineWidth = 2;

          samples.forEach((sample, i) => {
            const x = GRAPH_WIDTH - ((now - sample.timestamp) * GRAPH_WIDTH / WINDOW_DURATION);
            const y = yScale(sample.value);
            
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }
      });

      requestAnimationFrame(draw);
    };

    requestAnimationFrame(draw);

    ws.onclose = () => setStatus('Disconnected');

    return () => ws.close();
  }, []);

  return (
    <div className="p-4 bg-gray-900">
      <h1 className="text-2xl font-bold mb-4 text-white">EEG Monitor</h1>
      <div className="mb-2 text-gray-300">Status: {status}</div>
      
      {/* Time markers */}
      <div className="relative">
        <div className="absolute w-full flex justify-between px-2 -top-6 text-gray-400 text-sm">
          {TIME_TICKS.reverse().map(time => (
            <div key={time}>{time}s</div>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          {[0, 1, 2, 3].map((channelIndex) => (
            <div key={channelIndex} className="relative flex items-center">
              {/* Voltage markers */}
              <div className="absolute -left-12 h-full flex flex-col justify-between text-gray-400 text-xs">
                {VOLTAGE_TICKS.map(voltage => (
                  <div key={voltage}>{voltage}V</div>
                ))}
              </div>
              
              {/* Channel label */}
              <div className="absolute -left-8 top-1/2 transform -translate-y-1/2 text-gray-400 font-medium">
                Ch{channelIndex + 1}
              </div>

              {/* Canvas with improved styling */}
              <div className="flex-grow">
                <canvas
                  ref={(el) => (canvasRefs.current[channelIndex] = el)}
                  width={GRAPH_WIDTH}
                  height={GRAPH_HEIGHT}
                  className="w-full border border-gray-700 rounded-lg bg-gray-800/50 backdrop-blur-sm"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
} 