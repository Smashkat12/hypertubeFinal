pipeline {
    agent any

	tools {nodejs "nodejs"}
    stages {
        stage('install Node dependencies') {
            steps {
                sh 'npm install'
            }
        }
    }
}