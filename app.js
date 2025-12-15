import express from 'express'
import cors from 'cors'
import fs from 'fs/promises'
import { PORT } from './config.js'
import { runJob } from './index.js'
import { JobContext } from './jobContext.js'

const app = express()

app.use(cors())

app.use(express.json({ limit: '50mb' }))

app.get('/api/automation/start', async (req, res) => {
    // Check if job is already running
    if (JobContext.isRunning()) {
        return res.status(400).json({ success: false, message: 'Job is already running' })
    }

    // Run in background
    JobContext.setRunning(true)
    runJob().then(() => {
        JobContext.setRunning(false)
    }).catch(() => {
        JobContext.setRunning(false)
    })

    res.json({ success: true, message: 'Job started successfully', error: null })
})

app.get('/api/automation/status', (req, res) => {
    res.json({ isRunning: JobContext.isRunning() })
})

app.get('/api/automation/stop', (req, res) => {
    if (!JobContext.isRunning()) {
        return res.status(400).json({ success: false, message: 'No job is running' })
    }
    JobContext.setStopRequested(true)

    res.json({ success: true, message: 'Stop requested' })
})

app.post('/api/seed', async (req, res) => {
    try {
        const data = req.body
        await fs.writeFile('data.json', JSON.stringify(data, null, 2))
        res.json({ success: true, message: 'Data seeded successfully', error: null })
    } catch (error) {
        console.error('Seed error:', error)
        res.status(500).json({ success: false, message: 'Failed to seed data', error: error.message })
    }
})

app.get('/api/receive/data', async (req, res) => {
    try {
        const data = await fs.readFile('data.json', 'utf-8')
        res.json(JSON.parse(data))
    } catch (error) {
        console.error('Error reading data:', error)
        res.status(500).json({ success: false, message: 'Failed to read data', error: error.message })
    }
})

app.delete('/api/clear/data', async (req, res) => {
    try {
        await fs.writeFile('data.json', '[]')
        res.json({ success: true, message: 'Data cleared successfully', error: null })
    } catch (error) {
        console.error('Delete error:', error)
        res.status(500).json({ success: false, message: 'Failed to delete data', error: error.message })
    }
})

app.use((err, req, res, next) => {
    console.error(err.stack)
    res.status(500).json({ success: false, message: 'Internal Server Error', error: err.message })
})

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
})