pipeline {
    agent any
    stages {
        stage('install Node dependencies') {
            steps {
                sh(label: 'install React dependencies', script: 'node -v')
            }
        }
		stage('install React dependencies') {
			steps {
				sh(label: 'install React dependencies', script: 'npm -v')
			}
		}
    }
}
