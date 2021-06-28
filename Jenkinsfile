pipeline {
    agent any
    stages {
        stage('install Node dependencies') {
            steps {
                sh(label: 'install React dependencies', script: 'npm i')
            }
        }
		stage('install React dependencies') {
			steps {
				sh(label: 'install React dependencies', script: 'cd client && npm i')
			}
		}
    }
}
