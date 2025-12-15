
const state = {
    isJobRunning: false,
    stopRequested: false,
    jobId: null
}

export const JobContext = {
    getAll: () => ({ ...state }),

    isRunning: () => state.isJobRunning,
    setRunning: (status) => { state.isJobRunning = status },

    isStopRequested: () => state.stopRequested,
    setStopRequested: (status) => { state.stopRequested = status },

    getJobId: () => state.jobId,
    setJobId: (id) => { state.jobId = id }
}
