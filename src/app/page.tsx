import Image from "next/image";
import EegMonitor from '@/components/EegMonitor';

export default function Home() {
  return (
    <div className="min-h-screen p-8">
      <EegMonitor />
    </div>
  );
}
