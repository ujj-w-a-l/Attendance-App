import React from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => {
  return (
    <div className={`animate-pulse bg-black/5 rounded ${className}`} />
  );
};

export const ClassCardSkeleton: React.FC = () => {
  return (
    <div className="bg-white p-6 rounded-2xl border border-black/5 flex flex-col justify-between min-h-[140px]">
      <div className="flex items-start gap-4">
        <Skeleton className="w-12 h-12 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <div className="mt-4">
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  );
};

export const StudentRowSkeleton: React.FC = () => {
  return (
    <div className="p-4 flex items-center gap-3">
      <Skeleton className="w-8 h-8 rounded-full" />
      <Skeleton className="flex-1 h-5" />
      <Skeleton className="w-16 h-5" />
    </div>
  );
};
