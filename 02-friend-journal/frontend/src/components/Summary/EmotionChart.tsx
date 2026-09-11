import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import type { EmotionData } from '@/types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface EmotionChartProps {
  emotionData: EmotionData[];
}

export default function EmotionChart({ emotionData }: EmotionChartProps) {
  const labels = emotionData.map((d) => d.date);
  const intensities = emotionData.map((d) => d.intensity);

  const data = {
    labels,
    datasets: [
      {
        label: '情绪强度',
        data: intensities,
        borderColor: 'rgb(147, 51, 234)',
        backgroundColor: 'rgba(147, 51, 234, 0.1)',
        tension: 0.4,
        fill: true,
      },
    ],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: '情绪变化曲线',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 1,
      },
    },
  };

  return <Line data={data} options={options} />;
}



